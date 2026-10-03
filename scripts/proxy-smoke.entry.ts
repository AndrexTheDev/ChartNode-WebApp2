/* © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md. */
/** Offline security/resilience checks for the allowlisted Edge proxy routes. */
export {};

let failures = 0;
function check(name: string, condition: boolean): void {
  console.log(`${condition ? '  PASS' : '  FAIL'}  ${name}`);
  if (!condition) failures += 1;
}

const upstreamCalls: Array<{ url: string; method: string; body: string | null }> = [];
(globalThis as unknown as { fetch: typeof fetch }).fetch = async (input, init = {}) => {
  upstreamCalls.push({ url: String(input), method: init.method || 'GET', body: typeof init.body === 'string' ? init.body : null });
  return Response.json({ pairs: [], result: '0x1234' }, {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};

const { GET, POST } = await import('@/app/api/proxy/[provider]/route');
const context = (provider: string) => ({ params: Promise.resolve({ provider }) });

const address = '0x1111111111111111111111111111111111111111';
const dexResponse = await GET(new Request(`https://nodechart.test/api/proxy/dexscreener?address=${address}`), context('dexscreener'));
const dexBody = await dexResponse.json() as { pairs?: unknown[] };
check('DexScreener proxy uses the fixed allowlisted host and emits shared-edge cache headers',
  dexResponse.status === 200 && upstreamCalls.at(-1)?.url === `https://api.dexscreener.com/latest/dex/tokens/${address}`
    && dexResponse.headers.get('cache-control')?.includes('s-maxage=15') === true && Array.isArray(dexBody.pairs));

const beforeInvalid = upstreamCalls.length;
const invalidDex = await GET(new Request('https://nodechart.test/api/proxy/dexscreener?address=https://evil.test'), context('dexscreener'));
check('invalid token addresses cannot turn the proxy into an SSRF endpoint', invalidDex.status === 400 && upstreamCalls.length === beforeInvalid);

const invalidMempool = await GET(new Request('https://nodechart.test/api/proxy/mempool?endpoint=../../secret'), context('mempool'));
check('Mempool proxy only accepts named fixed API resources', invalidMempool.status === 400);

const invalidGoPlus = await GET(new Request(`https://nodechart.test/api/proxy/goplus?chain=unknown&address=${address}`), context('goplus'));
check('GoPlus proxy validates supported networks before egress', invalidGoPlus.status === 400);

const rpcUrl = 'https://nodechart.test/api/proxy/rpc?endpoint=ethereum-rpc.publicnode.com';
const disallowedRpc = await POST(new Request(rpcUrl, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_sendRawTransaction', params: ['0xdead'] }),
}), context('rpc'));
check('RPC proxy refuses transaction-writing methods', disallowedRpc.status === 400);

const rpcResponse = await POST(new Request(rpcUrl, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'eth_call', params: [{ to: address, data: '0x18160ddd' }, 'latest'] }),
}), context('rpc'));
const rpcCall = upstreamCalls.at(-1);
check('RPC proxy forwards only bounded, read-only JSON-RPC to a pinned endpoint',
  rpcResponse.status === 200 && rpcCall?.url === 'https://ethereum-rpc.publicnode.com'
    && rpcCall.method === 'POST' && JSON.parse(rpcCall.body || '{}').method === 'eth_call');

if (failures > 0) process.exitCode = 1;
else console.log('\n✔ proxy route security smoke OK');
