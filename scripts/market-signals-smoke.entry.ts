/* © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md. */
/** Offline/mocked smoke checks for TASK 5 market data and support verification. */
export {};

(globalThis as unknown as { window: unknown }).window = globalThis;
const storage = new Map<string, string>();
(globalThis as unknown as { localStorage: unknown }).localStorage = {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => { storage.set(key, String(value)); },
  removeItem: (key: string) => { storage.delete(key); },
};

let failures = 0;
function check(name: string, condition: boolean): void {
  console.log(`${condition ? '  PASS' : '  FAIL'}  ${name}`);
  if (!condition) failures += 1;
}
function response(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });
}

const candles = Array.from({ length: 60 }, (_, index) => {
  const close = 100 + index;
  return [1_700_000_000 + index * 300, close, close + 1, close - 1, close, 10];
});
const alphaContract = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
let donationAmountWei = '0xde0b6b3a7640000';
const ethereumDestination = '0xBC3fab34f69bc9f6661608C3FB36dDdC313C42F7';
let clientDonationAttempts = 0;
let failNextClientDonation = false;
const upstreamCalls: string[] = [];

(globalThis as unknown as { fetch: typeof fetch }).fetch = async (input, init) => {
  const url = String(input);
  upstreamCalls.push(url);
  if (url === '/api/verify-donation') {
    clientDonationAttempts += 1;
    if (failNextClientDonation) {
      failNextClientDonation = false;
      return response({ status: 'unavailable', message: 'temporary outage' }, 503);
    }
    const request = JSON.parse(String(init?.body ?? '{}')) as { txHash?: string };
    return response({
      status: 'verified', txHash: request.txHash, recipient: ethereumDestination,
      amountNative: 0.01, asset: 'ETH', amountUsd: 10, blockTime: 1_700_000_000,
      confirmations: 12, finality: '12 confirmations',
    });
  }
  if (url.endsWith('/api/mempool')) return response({ count: 4_200, vsize: 8_000_000, total_fee: 123_000 });
  if (url.endsWith('/api/v1/fees/recommended')) return response({ fastestFee: 18, halfHourFee: 14, hourFee: 10, economyFee: 7 });
  if (url.endsWith('/api/v1/difficulty-adjustment')) return response({ difficultyChange: 2.4, remainingBlocks: 120, timeAvg: 610_000 });
  if (url.endsWith('/v2/chains')) return response([{ name: 'Ethereum', tvl: 12_000 }]);
  if (url.endsWith('/v2/historicalChainTvl')) return response([
    { date: 1_700_000_000, tvl: 100 },
    { date: 1_700_086_400, tvl: 120 },
  ]);
  if (url.includes('stablecoins.llama.fi/stablecoins')) return response({ peggedAssets: [{ circulating: { peggedUSD: 50_000 } }] });
  if (url.startsWith('https://api.gopluslabs.io/api/v1/token_security/')) {
    const address = new URL(url).searchParams.get('contract_addresses')?.toLowerCase();
    if (address !== alphaContract.toLowerCase()) return response({ code: 1, result: {} });
    return response({ code: 1, result: { [alphaContract]: {
      holder_count: '200', buy_tax: '0.01', sell_tax: '0.02', is_mintable: '0', is_honeypot: '0',
      holders: [{ percent: '0.12' }, { percent: '0.07' }],
      lp_holders: [{ percent: '0.8', is_locked: '1' }],
    } } });
  }
  if (url.includes('/overview/dexs?')) return response({ total24h: 500_000_000 });
  if (url.endsWith('/ticker/24hr')) return response([
    { symbol: 'BTCUSDT', quoteVolume: '1000' },
    { symbol: 'ETHUSDC', quoteVolume: '2000' },
    { symbol: 'SOLFDUSD', quoteVolume: '3000' },
    { symbol: 'BTCETH', quoteVolume: '900000' },
  ]);
  if (url.includes('/api/v3/klines?')) return response(candles);
  if (url.endsWith('/protocols')) return response([
    { name: 'Alpha Protocol', slug: 'alpha-protocol', symbol: 'ALPHA' },
    { name: 'Duplicate One', slug: 'duplicate-one', symbol: 'DUP' },
    { name: 'Duplicate Two', slug: 'duplicate-two', symbol: 'dup' },
  ]);
  if (url.endsWith('/protocol/alpha-protocol')) {
    const now = Math.floor(Date.now() / 1000);
    return response({ tvl: [
      { date: now - 200 * 86_400, totalLiquidityUSD: 9_000 },
      { date: now - 30 * 86_400, totalLiquidityUSD: 10_000 },
      { date: now, totalLiquidityUSD: 12_000 },
    ] });
  }
  if (url.includes('/ticker/price?symbol=ALPHAUSDT')) return response({ symbol: 'ALPHAUSDT', price: '10' });
  if (url.startsWith('https://api.dexscreener.com/latest/dex/tokens/')) return response({ pairs: [
    { chainId: 'ethereum', dexId: 'dex-low', pairAddress: '0x1111111111111111111111111111111111111111', baseToken: { address: alphaContract, symbol: 'ALPHA' }, priceUsd: '11', liquidity: { usd: 50_000 } },
    { chainId: 'ethereum', dexId: 'dex-best', pairAddress: '0x2222222222222222222222222222222222222222', baseToken: { address: alphaContract, symbol: 'ALPHA' }, priceUsd: '12', marketCap: 90_000, fdv: 100_000, liquidity: { usd: 90_000 } },
    { chainId: 'polygon', dexId: 'quick', pairAddress: '0x3333333333333333333333333333333333333333', baseToken: { address: alphaContract, symbol: 'ALPHA' }, priceUsd: '9', liquidity: { usd: 20_000 } },
    { chainId: 'bsc', dexId: 'dust', pairAddress: '0x4444444444444444444444444444444444444444', baseToken: { address: alphaContract, symbol: 'ALPHA' }, priceUsd: '8', liquidity: { usd: 9_999 } },
  ] });
  if (url.startsWith('https://ethereum-rpc.publicnode.com') || url.startsWith('https://eth.llamarpc.com')) {
    const body = JSON.parse(String(init?.body ?? '{}')) as { method?: string };
    switch (body.method) {
      case 'eth_getTransactionByHash':
        return response({ result: { to: ethereumDestination, value: donationAmountWei, blockNumber: '0x100' } });
      case 'eth_getTransactionReceipt': return response({ result: { status: '0x1', blockNumber: '0x100' } });
      case 'eth_blockNumber': return response({ result: '0x110' });
      case 'eth_getBlockByNumber': return response({ result: { timestamp: '0x65000000' } });
      default: throw new Error(`Unexpected Ethereum RPC method: ${body.method}`);
    }
  }
  if (url.includes('/prices/historical/')) return response({ coins: { 'coingecko:ethereum': { price: 1_000 } } });
  throw new Error(`Unexpected mocked request: ${url}`);
};

const {
  fetchCrossChainSpread, fetchProtocolTvl, fetchTrendRadar, fetchVolumeComparison,
  isHighDilutionRisk, marketCapToFdvPercent,
} = await import('@/api/market-signals');
const { fetchBtcSignals, fetchDefiSignals, fetchTokenForensics } = await import('@/api/onchain');
const { fetchJson } = await import('@/api/http');
const { verifyDonationTransaction } = await import('@/api/verify-donation');
const { POST: verifyDonation } = await import('@/app/api/verify-donation/route');
const { useProAccessStore } = await import('@/store/useProAccessStore');
const { DONATION_WALLETS } = await import('@/lib/donation-wallets');

const cexToken = {
  id: 'CEX:binance:ALPHA/USDT', symbol: 'ALPHA/USDT', base: 'ALPHA', quote: 'USDT', venue: 'CEX' as const, exchange: 'binance',
};
const dexToken = {
  id: `DEX:ethereum:${alphaContract}`, symbol: 'ALPHA/USDC', base: 'ALPHA', quote: 'USDC', venue: 'DEX' as const,
  chain: 'ethereum', contract: alphaContract,
};

console.log('\n— shared public fetch resilience —');
const originalFetch = globalThis.fetch;
let transientAttempts = 0;
globalThis.fetch = (async (input, init) => {
  if (String(input) === 'https://retry-smoke.invalid/public.json') {
    transientAttempts += 1;
    if (transientAttempts === 1) throw new TypeError('simulated transient network/CORS failure');
    return response({ available: true });
  }
  return originalFetch(input, init);
}) as typeof fetch;
const retriedPayload = await fetchJson<{ available: boolean }>('https://retry-smoke.invalid/public.json', {
  source: 'smoke:retry', cacheTtlMs: 0,
});
globalThis.fetch = originalFetch;
check('shared fetch retries a transient network failure once and recovers without a proxy',
  transientAttempts === 2 && retriedPayload.available === true);

console.log('\n— on-chain public API resilience —');
const cancelled = new AbortController();
cancelled.abort();
check('mempool.space and DeFiLlama aborts resolve to unavailable data, not uncaught errors',
  await fetchBtcSignals(cancelled.signal) === null && await fetchDefiSignals(cancelled.signal) === null);
const btc = await fetchBtcSignals();
check('mempool.space fields normalize into BTC congestion/fee/difficulty readings', btc?.unconfirmed === 4_200
  && btc.fastestFee === 18 && btc.difficultyChangePct === 2.4);
const defi = await fetchDefiSignals();
check('DeFiLlama chains, historical TVL, and stablecoin supply parse from public payloads', defi?.totalTvlUsd === 120
  && defi.topChains[0]?.name === 'Ethereum' && defi.stablecoinSupplyUsd === 50_000);
const forensics = await fetchTokenForensics('ethereum', alphaContract);
check('GoPlus token-forensics response validates optional fields and missing records stay null', forensics?.holderCount === 200
  && forensics.sellTaxPct === 2 && forensics.isMintable === false
  && await fetchTokenForensics('ethereum', '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb') === null);
const cancelledForensics = await fetchTokenForensics('ethereum', '0xcccccccccccccccccccccccccccccccccccccccc', cancelled.signal);
check('GoPlus cancellation is handled as unavailable instead of an unhandled rejection', cancelledForensics === null);

console.log('\n— free market signals —');
const volume = await fetchVolumeComparison();
check('volume ratio sums only Binance Spot USD-pegged quote pairs', volume.binanceSpotVolumeUsd === 6_000);
check('DEX-vs-Binance volume ratio and source labels are explicit', volume.dexToBinanceRatio === 500_000_000 / 6_000
  && volume.dexSource === 'DeFiLlama' && volume.cexSource === 'Binance Spot');
const radar = await fetchTrendRadar(cexToken);
check('EMA radar returns all five requested intervals in order', radar.map((row) => row.timeframe).join(',') === '5m,15m,1h,4h,1d');
check('EMA20/EMA50 radar classifies an increasing market as bullish', radar.length === 5
  && radar.every((row) => row.direction === 'bullish' && row.candleCount === 60));

console.log('\n— Pro market signals —');
const tvl = await fetchProtocolTvl('ALPHA');
check('protocol TVL graph data is bounded to the recent 120-day window', tvl.status === 'ok' && tvl.protocolSlug === 'alpha-protocol'
  && tvl.points.length === 2 && tvl.points[0]?.value === 10_000 && tvl.points[1]?.value === 12_000);
const ambiguous = await fetchProtocolTvl('DUP');
check('ambiguous protocol tickers fail closed instead of selecting the wrong TVL', ambiguous.status === 'ambiguous' && ambiguous.points.length === 0);
const spread = await fetchCrossChainSpread(dexToken);
check('spread matrix keeps the most liquid pool per chain and omits < $10k liquidity', spread.rows.length === 2
  && spread.rows[0]?.pairAddress === '0x2222222222222222222222222222222222222222'
  && spread.rows[1]?.chain === 'polygon');
check('spread is calculated versus the explicitly labeled Binance Spot price', spread.cexSource === 'Binance Spot'
  && spread.cexPriceUsd === 10 && Math.abs((spread.rows[0]?.spreadPct ?? 0) - 20) < 1e-9
  && Math.abs((spread.rows[1]?.spreadPct ?? 0) + 10) < 1e-9);
check('free DexScreener market-cap/FDV metadata is exposed as an optional tokenomics proxy',
  spread.rows[0]?.marketCapUsd === 90_000 && spread.rows[0]?.fdvUsd === 100_000
    && spread.rows[0]!.marketCapUsd / spread.rows[0]!.fdvUsd === 0.9);
check('high-dilution badge uses a strict market-cap/FDV threshold below 0.5',
  marketCapToFdvPercent(49, 100) === 49 && isHighDilutionRisk(49)
    && marketCapToFdvPercent(50, 100) === 50 && !isHighDilutionRisk(50)
    && marketCapToFdvPercent(null, 100) === null && !isHighDilutionRisk(null));

console.log('\n— donation verification and Pro gating —');
const malformed = await verifyDonation(new Request('https://nodechart.test/api/verify-donation', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chain: 'ethereum', txHash: 'nope' }),
}));
check('malformed transaction hashes are rejected before contacting a provider', malformed.status === 400);
const validHash = `0x${'1'.repeat(64)}`;
const verified = await verifyDonation(new Request('https://nodechart.test/api/verify-donation', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chain: 'ethereum', txHash: validHash }),
}));
const verifiedBody = await verified.json() as { status?: string; amountUsd?: number; confirmations?: number; recipient?: string };
check('native ETH donation must match the existing recipient and reach 12 confirmations', verifiedBody.status === 'verified'
  && verifiedBody.amountUsd === 1_000 && (verifiedBody.confirmations ?? 0) >= 12
  && verifiedBody.recipient === DONATION_WALLETS.find((wallet) => wallet.chain === 'ethereum')?.address);
donationAmountWei = '0x38d7ea4c68000';
const belowMinimum = await verifyDonation(new Request('https://nodechart.test/api/verify-donation', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chain: 'ethereum', txHash: `0x${'2'.repeat(64)}` }),
}));
const belowBody = await belowMinimum.json() as { status?: string; amountUsd?: number };
check('$5-equivalent one-time minimum is enforced on historical transaction value', belowBody.status === 'below-minimum' && belowBody.amountUsd === 1);
const donationClientCountBefore = clientDonationAttempts;
failNextClientDonation = true;
const clientVerification = await verifyDonationTransaction('ethereum', validHash);
check('client donation verification retries one transient 5xx response and returns a proof',
  clientDonationAttempts === donationClientCountBefore + 2 && clientVerification.status === 'verified'
    && clientVerification.proof?.txHash === validHash && clientVerification.proof.confirmations === 12);

const store = useProAccessStore.getState();
await store.grant({
  chain: 'ethereum', txHash: `0x${'a'.repeat(64)}`, recipient: ethereumDestination,
  amountNative: 0.01, asset: 'ETH', amountUsd: 10, blockTime: 1_700_000_000,
  confirmations: 12, finality: '12 confirmations', verifiedAt: 1_700_000_001,
});
const exportMarker = JSON.parse(storage.get('nc-nodecluster-pro-export-v1') || 'null') as {
  status?: string; txHash?: string; version?: number; salt?: string; digest?: string;
} | null;
check('successful Pro verification persists a salted SHA-256 export-entitlement digest',
  exportMarker?.status === 'verified' && exportMarker.version === 1
    && exportMarker.txHash === `0x${'a'.repeat(64)}`
    && /^[\da-f]{32}$/i.test(exportMarker.salt ?? '') && /^[\da-f]{64}$/i.test(exportMarker.digest ?? ''));
store.setChecking();
check('Pro revalidation clears the export marker until the chain confirms the saved proof',
  storage.get('nc-nodecluster-pro-export-v1') === undefined);
check('Pro remains locked while the saved proof is being revalidated', !useProAccessStore.getState().proof || useProAccessStore.getState().verification !== 'verified');
store.setUnavailable('offline');
check('provider outage never grants Pro', !useProAccessStore.getState().proof || useProAccessStore.getState().verification !== 'verified');
store.lock();
check('invalid/revoked proof clears local entitlement', useProAccessStore.getState().proof === null && useProAccessStore.getState().verification === 'locked');

if (failures > 0) {
  console.error(`\n✖ market signals smoke: ${failures} failure(s)`);
  process.exitCode = 1;
} else {
  console.log('\n✔ market signals mocked smoke OK');
}
