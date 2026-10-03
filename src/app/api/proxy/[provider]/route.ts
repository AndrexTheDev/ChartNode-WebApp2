// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
// Allowlisted, zero-dependency serverless relay for public JSON APIs. Never
// accept an arbitrary upstream URL: every destination is fixed in this file.
// OpenNext Cloudflare does not support Next's Edge Runtime; these standard
// serverless route handlers run on the free Cloudflare Worker deployment.
export const runtime = 'nodejs';

const UPSTREAM_TIMEOUT_MS = 3_000;
const MAX_JSON_BYTES = 2 * 1024 * 1024;
const EVM_ADDRESS = /^0x[a-f\d]{40}$/i;
const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const AUTHORIZATION = /^Bearer\s+[A-Za-z0-9._~+\/-]{1,512}={0,2}$/i;

type RouteContext = { params: Promise<{ provider: string }> };
type UpstreamConfig = {
  url: string;
  cacheSeconds: number;
  authorization?: string | null;
};

const GOPLUS_PATHS: Record<string, string> = {
  ethereum: 'token_security/1',
  base: 'token_security/8453',
  arbitrum: 'token_security/42161',
  optimism: 'token_security/10',
  polygon: 'token_security/137',
  bsc: 'token_security/56',
  avalanche: 'token_security/43114',
  gnosis: 'token_security/100',
  celo: 'token_security/42220',
  scroll: 'token_security/534352',
  linea: 'token_security/59144',
  solana: 'solana/token_security',
};

const BLOCKSCOUT_HOSTS: Record<string, string> = {
  ethereum: 'https://eth.blockscout.com',
  base: 'https://base.blockscout.com',
  arbitrum: 'https://arbitrum.blockscout.com',
  optimism: 'https://optimism.blockscout.com',
  polygon: 'https://polygon.blockscout.com',
  bsc: 'https://bnb.blockscout.com',
  avalanche: 'https://avalanche.blockscout.com',
  gnosis: 'https://gnosis.blockscout.com',
  celo: 'https://celo.blockscout.com',
  scroll: 'https://scroll.blockscout.com',
  linea: 'https://linea.blockscout.com',
};

const RPC_ENDPOINTS: Record<string, { url: string; kind: 'evm' | 'solana' }> = {
  'ethereum-rpc.publicnode.com': { url: 'https://ethereum-rpc.publicnode.com', kind: 'evm' },
  'eth.llamarpc.com': { url: 'https://eth.llamarpc.com', kind: 'evm' },
  'base-rpc.publicnode.com': { url: 'https://base-rpc.publicnode.com', kind: 'evm' },
  'base.llamarpc.com': { url: 'https://base.llamarpc.com', kind: 'evm' },
  'arbitrum-one-rpc.publicnode.com': { url: 'https://arbitrum-one-rpc.publicnode.com', kind: 'evm' },
  'arbitrum.llamarpc.com': { url: 'https://arbitrum.llamarpc.com', kind: 'evm' },
  'optimism-rpc.publicnode.com': { url: 'https://optimism-rpc.publicnode.com', kind: 'evm' },
  'optimism.llamarpc.com': { url: 'https://optimism.llamarpc.com', kind: 'evm' },
  'polygon-bor-rpc.publicnode.com': { url: 'https://polygon-bor-rpc.publicnode.com', kind: 'evm' },
  'polygon.llamarpc.com': { url: 'https://polygon.llamarpc.com', kind: 'evm' },
  'bsc-rpc.publicnode.com': { url: 'https://bsc-rpc.publicnode.com', kind: 'evm' },
  'binance.llamarpc.com': { url: 'https://binance.llamarpc.com', kind: 'evm' },
  'avalanche-c-chain-rpc.publicnode.com': { url: 'https://avalanche-c-chain-rpc.publicnode.com', kind: 'evm' },
  'gnosis-rpc.publicnode.com': { url: 'https://gnosis-rpc.publicnode.com', kind: 'evm' },
  'rpc.gnosischain.com': { url: 'https://rpc.gnosischain.com', kind: 'evm' },
  'forno.celo.org': { url: 'https://forno.celo.org', kind: 'evm' },
  'rpc.scroll.io': { url: 'https://rpc.scroll.io', kind: 'evm' },
  'rpc.linea.build': { url: 'https://rpc.linea.build', kind: 'evm' },
  'api.mainnet-beta.solana.com': { url: 'https://api.mainnet-beta.solana.com', kind: 'solana' },
  'solana-rpc.publicnode.com': { url: 'https://solana-rpc.publicnode.com', kind: 'solana' },
};

const EVM_RPC_METHODS = new Set([
  'eth_call', 'eth_getCode', 'eth_getTransactionByHash', 'eth_getTransactionReceipt',
  'eth_getBlockByNumber', 'eth_blockNumber', 'eth_getBalance', 'eth_getTransactionCount',
]);
const SOLANA_RPC_METHODS = new Set([
  'getTokenLargestAccounts', 'getAccountInfo', 'getTokenSupply', 'getMultipleAccounts', 'getTransaction',
]);
const MEMPOOL_PATHS: Record<string, string> = {
  mempool: '/api/mempool',
  fees: '/api/v1/fees/recommended',
  difficulty: '/api/v1/difficulty-adjustment',
};
const BINANCE_FUTURES_PATHS: Record<string, string> = {
  openInterest: '/fapi/v1/openInterest',
  depth: '/fapi/v1/depth',
  premiumIndex: '/fapi/v1/premiumIndex',
};

function json(status: number, body: Record<string, unknown>, cacheControl = 'no-store'): Response {
  return Response.json(body, {
    status,
    headers: {
      'cache-control': cacheControl,
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
    },
  });
}

async function readLimitedBody(request: Request, maxBytes: number): Promise<string | null> {
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function validTokenAddress(chain: string, address: string): boolean {
  return chain === 'solana' ? SOLANA_ADDRESS.test(address) : EVM_ADDRESS.test(address);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 160) : 'upstream unavailable';
}

async function relayJson(
  request: Request,
  upstream: UpstreamConfig,
  init: RequestInit = {},
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  const forwardAbort = () => controller.abort(request.signal.reason);
  request.signal.addEventListener('abort', forwardAbort, { once: true });
  const privateResponse = Boolean(upstream.authorization);
  try {
    const response = await fetch(upstream.url, {
      ...init,
      cache: 'no-store',
      redirect: 'error',
      signal: controller.signal,
      headers: {
        accept: 'application/json',
        ...(upstream.authorization ? { authorization: upstream.authorization } : {}),
        ...init.headers,
      },
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      const status = response.status === 429 ? 429 : response.status >= 500 ? 502 : response.status;
      return json(status, { error: 'upstream_unavailable', upstreamStatus: response.status });
    }
    const contentType = response.headers.get('content-type') || '';
    if (!/json|text\/plain/i.test(contentType)) {
      await response.body?.cancel().catch(() => undefined);
      return json(502, { error: 'upstream_not_json' });
    }
    const declaredLength = Number(response.headers.get('content-length') || 0);
    if (Number.isFinite(declaredLength) && declaredLength > MAX_JSON_BYTES) {
      await response.body?.cancel().catch(() => undefined);
      return json(413, { error: 'upstream_response_too_large' });
    }
    const body = await response.text();
    if (new TextEncoder().encode(body).byteLength > MAX_JSON_BYTES) {
      return json(413, { error: 'upstream_response_too_large' });
    }
    try {
      JSON.parse(body);
    } catch {
      return json(502, { error: 'upstream_invalid_json' });
    }
    const cacheControl = privateResponse
      ? 'private, no-store'
      : `public, max-age=0, s-maxage=${upstream.cacheSeconds}, stale-while-revalidate=${upstream.cacheSeconds * 2}`;
    return new Response(body, {
      status: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': cacheControl,
        'x-content-type-options': 'nosniff',
        'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
      },
    });
  } catch (error) {
    return json(controller.signal.aborted ? 504 : 502, {
      error: controller.signal.aborted ? 'upstream_timeout' : 'upstream_unavailable',
      message: errorMessage(error),
    });
  } finally {
    clearTimeout(timeoutId);
    request.signal.removeEventListener('abort', forwardAbort);
  }
}

async function getUpstream(provider: string, params: URLSearchParams, request: Request): Promise<UpstreamConfig | Response> {
  if (provider === 'dexscreener') {
    const address = params.get('address') || '';
    if (!EVM_ADDRESS.test(address) && !SOLANA_ADDRESS.test(address)) return json(400, { error: 'invalid_address' });
    return {
      url: `https://api.dexscreener.com/latest/dex/tokens/${encodeURIComponent(address)}`,
      cacheSeconds: 15,
    };
  }

  if (provider === 'goplus') {
    const chain = params.get('chain') || '';
    const address = params.get('address') || '';
    const path = GOPLUS_PATHS[chain];
    if (!path || !validTokenAddress(chain, address)) return json(400, { error: 'invalid_chain_or_address' });
    const authorization = request.headers.get('authorization');
    if (authorization && !AUTHORIZATION.test(authorization)) return json(400, { error: 'invalid_authorization' });
    const target = new URL(`https://api.gopluslabs.io/api/v1/${path}`);
    target.searchParams.set('contract_addresses', address);
    return { url: target.toString(), cacheSeconds: 30, authorization };
  }

  if (provider === 'mempool') {
    const endpoint = params.get('endpoint') || '';
    const path = MEMPOOL_PATHS[endpoint];
    if (!path) return json(400, { error: 'invalid_endpoint' });
    return { url: `https://mempool.space${path}`, cacheSeconds: 5 };
  }

  if (provider === 'blockscout') {
    const chain = params.get('chain') || '';
    const address = params.get('address') || '';
    const resource = params.get('resource') || '';
    const host = BLOCKSCOUT_HOSTS[chain];
    if (!host || !EVM_ADDRESS.test(address) || !['token', 'holders'].includes(resource)) {
      return json(400, { error: 'invalid_chain_address_or_resource' });
    }
    const target = new URL(`/api/v2/tokens/${encodeURIComponent(address)}${resource === 'holders' ? '/holders' : ''}`, host);
    if (resource === 'holders') {
      const count = Math.min(50, Math.max(1, Math.trunc(Number(params.get('count') || 20))));
      target.searchParams.set('items_count', String(Number.isFinite(count) ? count : 20));
    }
    return { url: target.toString(), cacheSeconds: 15 };
  }

  if (provider === 'honeypot') {
    const address = params.get('address') || '';
    const chainId = params.get('chainId') || '';
    if (!EVM_ADDRESS.test(address) || !/^\d{1,8}$/.test(chainId)) return json(400, { error: 'invalid_address_or_chain' });
    const target = new URL('https://api.honeypot.is/v2/IsHoneypot');
    target.searchParams.set('address', address);
    target.searchParams.set('chainID', chainId);
    return { url: target.toString(), cacheSeconds: 15 };
  }

  if (provider === 'binancefutures') {
    const endpoint = params.get('endpoint') || '';
    const path = BINANCE_FUTURES_PATHS[endpoint];
    const symbol = (params.get('symbol') || '').toUpperCase();
    if (!path || !/^[A-Z0-9]{4,24}$/.test(symbol)) return json(400, { error: 'invalid_endpoint_or_symbol' });
    const target = new URL(`https://fapi.binance.com${path}`);
    target.searchParams.set('symbol', symbol);
    if (endpoint === 'depth') target.searchParams.set('limit', '100');
    return { url: target.toString(), cacheSeconds: 2 };
  }

  return json(404, { error: 'unsupported_proxy' });
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const { provider } = await context.params;
  const upstream = await getUpstream(provider, new URL(request.url).searchParams, request);
  if (upstream instanceof Response) return upstream;
  return relayJson(request, upstream);
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const { provider } = await context.params;
  if (provider !== 'rpc') return json(405, { error: 'method_not_allowed' });
  const endpoint = new URL(request.url).searchParams.get('endpoint') || '';
  const rpc = RPC_ENDPOINTS[endpoint.toLowerCase()];
  if (!rpc) return json(400, { error: 'unsupported_rpc_endpoint' });
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (Number.isFinite(contentLength) && contentLength > 32_000) return json(413, { error: 'rpc_request_too_large' });

  const text = await readLimitedBody(request, 32_000);
  if (text == null) return json(413, { error: 'rpc_request_too_large' });
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return json(400, { error: 'invalid_json' });
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return json(400, { error: 'invalid_rpc_request' });
  const rpcBody = body as { jsonrpc?: unknown; method?: unknown; params?: unknown; id?: unknown };
  const allowedMethods = rpc.kind === 'solana' ? SOLANA_RPC_METHODS : EVM_RPC_METHODS;
  if (rpcBody.jsonrpc !== '2.0' || typeof rpcBody.method !== 'string' || !allowedMethods.has(rpcBody.method)
    || !Array.isArray(rpcBody.params) || rpcBody.params.length > 8) {
    return json(400, { error: 'rpc_method_not_allowed' });
  }
  return relayJson(request, { url: rpc.url, cacheSeconds: 0 }, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(rpcBody),
  });
}
