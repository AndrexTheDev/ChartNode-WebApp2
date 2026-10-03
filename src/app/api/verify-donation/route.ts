// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
import { DONATION_WALLETS, MIN_PRO_DONATION_USD, type DonationChain } from '@/lib/donation-wallets';

const EVM_CONFIRMATIONS_REQUIRED = 12;
const COIN_IDS: Record<DonationChain, string> = {
  ethereum: 'ethereum',
  bitcoin: 'bitcoin',
  solana: 'solana',
};
const RECIPIENTS = Object.fromEntries(DONATION_WALLETS.map((wallet) => [wallet.chain, wallet.address])) as Record<DonationChain, string>;

type VerifyStatus = 'verified' | 'below-minimum' | 'pending' | 'not-found' | 'invalid';

interface VerifyBody {
  chain?: unknown;
  txHash?: unknown;
}

function json(status: number, body: Record<string, unknown>): Response {
  return Response.json(body, {
    status,
    headers: {
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}

function validHash(chain: DonationChain, hash: string): boolean {
  if (chain === 'ethereum') return /^0x[\da-f]{64}$/i.test(hash);
  if (chain === 'bitcoin') return /^[\da-f]{64}$/i.test(hash);
  return /^[1-9A-HJ-NP-Za-km-z]{64,100}$/.test(hash);
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    cache: 'no-store',
    signal: AbortSignal.timeout(9_000),
    headers: { accept: 'application/json', ...init?.headers },
  });
  if (!response.ok) throw new Error(`upstream ${response.status}`);
  return (await response.json()) as T;
}

async function postRpc<T>(url: string, method: string, params: unknown[]): Promise<T | null> {
  const payload = await fetchJson<{ result?: T | null; error?: { message?: string } }>(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  if (payload.error) throw new Error(payload.error.message || `${method} failed`);
  return payload.result ?? null;
}

async function callFirst<T>(urls: string[], method: string, params: unknown[]): Promise<T | null> {
  let lastError: unknown;
  for (const url of urls) {
    try {
      return await postRpc<T>(url, method, params);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Public RPC unavailable');
}

interface Payment {
  amountNative: number;
  blockTime: number;
  confirmations: number | null;
  finality: string;
  recipient: string;
}

async function verifyEthereum(hash: string): Promise<Payment | VerifyStatus> {
  const rpcUrls = ['https://ethereum-rpc.publicnode.com', 'https://eth.llamarpc.com'];
  const tx = await callFirst<{
    to?: string | null;
    value?: string;
    blockNumber?: string | null;
    from?: string;
  }>(rpcUrls, 'eth_getTransactionByHash', [hash]);
  if (!tx) return 'not-found';
  if (tx.to?.toLowerCase() !== RECIPIENTS.ethereum.toLowerCase()) return 'invalid';

  let value: bigint;
  try {
    value = BigInt(tx.value || '0x0');
  } catch {
    return 'invalid';
  }
  if (value <= 0n) return 'invalid';

  const [receipt, latestBlock] = await Promise.all([
    callFirst<{
      status?: string;
      blockNumber?: string | null;
    }>(rpcUrls, 'eth_getTransactionReceipt', [hash]),
    callFirst<string>(rpcUrls, 'eth_blockNumber', []),
  ]);
  if (!receipt?.blockNumber || !tx.blockNumber) return 'pending';
  if (receipt.status !== '0x1') return 'invalid';

  let confirmations = 0;
  try {
    confirmations = Number(BigInt(latestBlock || '0x0') - BigInt(receipt.blockNumber) + 1n);
  } catch {
    return 'pending';
  }
  if (confirmations < EVM_CONFIRMATIONS_REQUIRED) return 'pending';

  const block = await callFirst<{ timestamp?: string }>(rpcUrls, 'eth_getBlockByNumber', [receipt.blockNumber, false]);
  if (!block?.timestamp) return 'pending';
  const blockTime = Number.parseInt(block.timestamp, 16);
  const amountNative = Number(value) / 1e18;
  if (!Number.isFinite(blockTime) || !Number.isFinite(amountNative) || amountNative <= 0) return 'invalid';

  return {
    amountNative,
    blockTime,
    confirmations,
    finality: `${confirmations} confirmations`,
    recipient: RECIPIENTS.ethereum,
  };
}

interface SolanaInstruction {
  program?: string;
  parsed?: {
    type?: string;
    info?: { destination?: string; lamports?: number | string };
  };
}

async function verifySolana(hash: string): Promise<Payment | VerifyStatus> {
  const rpcUrls = ['https://solana-rpc.publicnode.com', 'https://api.mainnet-beta.solana.com'];
  const result = await callFirst<{
    blockTime?: number | null;
    meta?: { err?: unknown; innerInstructions?: { instructions?: SolanaInstruction[] }[] } | null;
    transaction?: { message?: { instructions?: SolanaInstruction[] } };
  }>(rpcUrls, 'getTransaction', [hash, {
    commitment: 'finalized',
    encoding: 'jsonParsed',
    maxSupportedTransactionVersion: 0,
  }]);
  if (!result) return 'pending';
  if (result.meta?.err != null || !result.blockTime) return 'invalid';

  const instructions = [
    ...(result.transaction?.message?.instructions ?? []),
    ...(result.meta?.innerInstructions ?? []).flatMap((group) => group.instructions ?? []),
  ];
  const lamports = instructions.reduce((sum, instruction) => {
    const parsed = instruction.parsed;
    if (instruction.program !== 'system' || !parsed || !['transfer', 'transferWithSeed'].includes(parsed.type || '')) return sum;
    if (parsed.info?.destination !== RECIPIENTS.solana) return sum;
    const amount = Number(parsed.info.lamports);
    return Number.isFinite(amount) && amount > 0 ? sum + amount : sum;
  }, 0);
  if (lamports <= 0) return 'invalid';

  return {
    amountNative: lamports / 1e9,
    blockTime: result.blockTime,
    confirmations: null,
    finality: 'finalized',
    recipient: RECIPIENTS.solana,
  };
}

interface BitcoinTransaction {
  status?: { confirmed?: boolean; block_time?: number; block_height?: number };
  vout?: { value?: number; scriptpubkey_address?: string }[];
}

async function verifyBitcoin(hash: string): Promise<Payment | VerifyStatus> {
  const transaction = await fetchJson<BitcoinTransaction>(`https://mempool.space/api/tx/${hash}`);
  if (!transaction.status?.confirmed || !transaction.status.block_time) return 'pending';
  const satoshis = (transaction.vout ?? []).reduce((sum, output) => (
    output.scriptpubkey_address === RECIPIENTS.bitcoin && Number.isSafeInteger(output.value) && (output.value ?? 0) > 0
      ? sum + (output.value ?? 0)
      : sum
  ), 0);
  if (satoshis <= 0) return 'invalid';

  return {
    amountNative: satoshis / 1e8,
    blockTime: transaction.status.block_time,
    confirmations: 1,
    finality: 'confirmed in a Bitcoin block',
    recipient: RECIPIENTS.bitcoin,
  };
}

async function historicalUsdPrice(chain: DonationChain, timestamp: number): Promise<number> {
  const coin = `coingecko:${COIN_IDS[chain]}`;
  const payload = await fetchJson<{ coins?: Record<string, { price?: number }> }>(
    `https://coins.llama.fi/prices/historical/${Math.floor(timestamp)}/${coin}?searchWidth=4h`,
  );
  const price = payload.coins?.[coin]?.price;
  if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) {
    throw new Error('historical price unavailable');
  }
  return price;
}

export async function POST(request: Request): Promise<Response> {
  let body: VerifyBody;
  try {
    if (Number(request.headers.get('content-length') ?? 0) > 2048) return json(413, { status: 'invalid' });
    body = await request.json() as VerifyBody;
  } catch {
    return json(400, { status: 'invalid', message: 'Invalid request body.' });
  }

  const chain = body.chain;
  const txHash = typeof body.txHash === 'string' ? body.txHash.trim() : '';
  if (chain !== 'ethereum' && chain !== 'bitcoin' && chain !== 'solana') {
    return json(400, { status: 'invalid', message: 'Unsupported network.' });
  }
  if (txHash.length > 100 || !validHash(chain, txHash)) {
    return json(400, { status: 'invalid', message: 'Transaction hash format is invalid.' });
  }

  try {
    const payment = chain === 'ethereum'
      ? await verifyEthereum(txHash)
      : chain === 'bitcoin'
        ? await verifyBitcoin(txHash.toLowerCase())
        : await verifySolana(txHash);

    if (typeof payment === 'string') {
      const message = payment === 'pending'
        ? 'The transaction is not yet final. Wait for confirmations and try again.'
        : payment === 'not-found'
          ? 'Transaction not found on the selected network.'
          : 'The transaction does not pay the configured NodeChart tip address.';
      return json(200, { status: payment, message, minDonationUsd: MIN_PRO_DONATION_USD });
    }

    const nativeUsd = await historicalUsdPrice(chain, payment.blockTime);
    const amountUsd = payment.amountNative * nativeUsd;
    if (!Number.isFinite(amountUsd) || amountUsd <= 0) {
      return json(502, { status: 'unavailable', message: 'Could not value this transaction.' });
    }
    const status: VerifyStatus = amountUsd >= MIN_PRO_DONATION_USD ? 'verified' : 'below-minimum';

    return json(200, {
      status,
      chain,
      txHash,
      recipient: payment.recipient,
      amountNative: payment.amountNative,
      asset: chain === 'ethereum' ? 'ETH' : chain === 'bitcoin' ? 'BTC' : 'SOL',
      amountUsd,
      minDonationUsd: MIN_PRO_DONATION_USD,
      blockTime: payment.blockTime,
      confirmations: payment.confirmations,
      finality: payment.finality,
    });
  } catch {
    return json(502, {
      status: 'unavailable',
      message: 'A public chain or price-data provider is temporarily unavailable. Please retry later.',
    });
  }
}
