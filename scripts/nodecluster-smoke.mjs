#!/usr/bin/env node
/* © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md. */
/** Offline, mocked integration tests for the standalone public NodeCluster runtime. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import vm from 'node:vm';

const source = readFileSync(new URL('./nodecluster.runtime.js', import.meta.url), 'utf8');

function jsonResponse(payload, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => payload };
}

function bytesToHex(bytes) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function makeExportMarker(proof) {
  const salt = bytesToHex(webcrypto.getRandomValues(new Uint8Array(16)));
  const payload = [
    'nodechart-pro-export-v1', proof.chain, proof.txHash.trim().toLowerCase(), String(Number(proof.verifiedAt)),
    String(Number(proof.amountUsd)), String(proof.recipient || '').trim().toLowerCase(),
    String(Number(proof.amountNative)), String(Number(proof.blockTime)), String(proof.asset || ''), salt,
  ].join('|');
  const digest = await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(payload));
  return {
    version: 1,
    status: 'verified',
    chain: proof.chain,
    txHash: proof.txHash,
    verifiedAt: proof.verifiedAt,
    salt,
    digest: bytesToHex(new Uint8Array(digest)),
  };
}

function createCanvas() {
  const gradient = { addColorStop() {} };
  const drawCalls = [];
  const target = {
    createLinearGradient: () => gradient,
    createRadialGradient: () => gradient,
    setTransform() {},
    clearRect() {},
    fillText(...args) { drawCalls.push({ text: String(args[0]), alpha: target.globalAlpha ?? 1 }); },
  };
  const context = new Proxy(target, {
    get(contextTarget, key) {
      if (key in contextTarget) return contextTarget[key];
      return () => {};
    },
  });
  const listeners = new Map();
  return {
    width: 400,
    height: 300,
    clientWidth: 400,
    clientHeight: 300,
    style: { touchAction: 'pan-x pan-y' },
    dataset: {},
    parentElement: null,
    drawCalls,
    removed: false,
    toDataURL: () => 'data:image/png;base64,ZmFrZQ==',
    remove() { this.removed = true; },
    getContext: () => context,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 300 }),
    addEventListener(type, listener) {
      const entries = listeners.get(type) || new Set();
      entries.add(listener);
      listeners.set(type, entries);
    },
    removeEventListener(type, listener) { listeners.get(type)?.delete(listener); },
    listenerCount(type) { return listeners.get(type)?.size ?? 0; },
    dispatchPointer(type, init = {}) {
      const event = {
        type,
        pointerId: 1,
        pointerType: 'touch',
        button: 0,
        clientX: 150,
        clientY: 150,
        deltaY: 0,
        defaultPrevented: false,
        preventDefault() { this.defaultPrevented = true; },
        ...init,
      };
      for (const listener of listeners.get(type) || []) listener(event);
      return event;
    },
    setPointerCapture() {},
    releasePointerCapture() {},
  };
}

function createRuntime(fetchMock, options = {}) {
  const listeners = new Map();
  const documentListeners = new Map();
  const events = [];
  const intervals = new Map();
  const animationFrames = new Map();
  const resizeObservers = [];
  const exportCanvases = [];
  const storage = new Map(Object.entries(options.localStorage || {}));
  const localStorage = {
    getItem(key) { return storage.get(key) ?? null; },
    setItem(key, value) { storage.set(key, String(value)); },
    removeItem(key) { storage.delete(key); },
  };
  let rafId = 0;
  let intervalId = 0;
  let performanceTime = options.performanceStart ?? 1000;
  let performanceStepMs = options.performanceStepMs ?? 0;
  const window = {
    crypto: webcrypto,
    devicePixelRatio: options.devicePixelRatio ?? 1,
    localStorage,
    innerWidth: options.innerWidth ?? 1280,
    matchMedia: (query) => ({ matches: query.includes('pointer: coarse') && Boolean(options.coarsePointer) }),
    setTimeout,
    clearTimeout,
    setInterval(callback, delay) {
      const id = ++intervalId;
      intervals.set(id, { callback, delay });
      return id;
    },
    clearInterval(id) { intervals.delete(id); },
    requestAnimationFrame(callback) {
      const id = ++rafId;
      animationFrames.set(id, callback);
      return id;
    },
    cancelAnimationFrame(id) { animationFrames.delete(id); },
    addEventListener(type, listener) {
      const items = listeners.get(type) || new Set();
      items.add(listener);
      listeners.set(type, items);
    },
    removeEventListener(type, listener) { listeners.get(type)?.delete(listener); },
    dispatchEvent(event) {
      events.push(event);
      for (const listener of listeners.get(event.type) || []) listener(event);
      return true;
    },
  };
  class MockCustomEvent {
    constructor(type, eventOptions = {}) { this.type = type; this.detail = eventOptions.detail; }
  }
  class MockResizeObserver {
    constructor(callback) { this.callback = callback; this.disconnected = false; resizeObservers.push(this); }
    observe() {}
    disconnect() { this.disconnected = true; }
  }
  const document = {
    hidden: false,
    documentElement: { clientWidth: window.innerWidth },
    body: { style: {}, appendChild() {}, classList: { add() {}, remove() {} } },
    createElement(tag) {
      if (tag !== 'canvas') return {};
      const canvas = createCanvas();
      exportCanvases.push(canvas);
      return canvas;
    },
    getElementById: () => null,
    addEventListener(type, listener) {
      const entries = documentListeners.get(type) || new Set();
      entries.add(listener);
      documentListeners.set(type, entries);
    },
    removeEventListener(type, listener) { documentListeners.get(type)?.delete(listener); },
  };
  const context = vm.createContext({
    window,
    document,
    navigator: options.navigator || { userAgent: 'NodeCluster smoke test', maxTouchPoints: 0 },
    ResizeObserver: MockResizeObserver,
    CustomEvent: MockCustomEvent,
    AbortController,
    URL,
    TextEncoder,
    crypto: webcrypto,
    fetch: fetchMock,
    performance: { now: () => { const current = performanceTime; performanceTime += performanceStepMs; return current; } },
    console: { warn() {}, error: console.error, log() {} },
  });
  vm.runInContext(source, context, { filename: 'scripts/nodecluster.runtime.js' });
  return {
    window,
    events,
    intervals,
    resizeObservers,
    exportCanvases,
    localStorage,
    api: window.NodeCluster,
    windowListenerCount(type) { return listeners.get(type)?.size ?? 0; },
    documentListenerCount(type) { return documentListeners.get(type)?.size ?? 0; },
    frameCount() { return animationFrames.size; },
    stepFrame(timestamp) {
      const next = animationFrames.entries().next().value;
      if (!next) return false;
      const [id, callback] = next;
      animationFrames.delete(id);
      callback(timestamp);
      return true;
    },
    setPerformanceStep(step) { performanceStepMs = step; },
    dispatch(type, detail = {}) { window.dispatchEvent(new MockCustomEvent(type, { detail })); },
  };
}

function waitForEvent(runtime, type, start) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${type}`)), 3000);
    const listener = (event) => {
      clearTimeout(timeout);
      runtime.window.removeEventListener(type, listener);
      resolve(event);
    };
    runtime.window.addEventListener(type, listener);
    start();
  });
}

function evmMockFetch({ holdAddress = null, heldRequest } = {}) {
  const calls = [];
  const address = {
    binance: '0x1111111111111111111111111111111111111111',
    coinbase: '0x2222222222222222222222222222222222222222',
    kraken: '0x3333333333333333333333333333333333333333',
    pool: '0x4444444444444444444444444444444444444444',
    owner: '0x5555555555555555555555555555555555555555',
    whale: '0x6666666666666666666666666666666666666666',
    standard: '0x7777777777777777777777777777777777777777',
  };
  const tokenAddresses = [address.binance, address.coinbase, address.kraken, address.pool, address.owner, address.whale, address.standard];
  const amounts = [3000, 250, 100, 500, 1000, 300, 50].map((value) => `${value}000000000000000000`);
  const totalSupply = '10000000000000000000000';

  const fetchMock = async (input, options = {}) => {
    const url = String(input);
    calls.push({ url, method: options.method || 'GET' });
    if (url.includes('/api/v2/tokens/') && url.includes('/holders?')) {
      const tokenAddress = url.match(/\/tokens\/(0x[0-9a-f]{40})\/holders/i)?.[1]?.toLowerCase();
      if (tokenAddress === holdAddress?.toLowerCase() && heldRequest) return heldRequest;
      return jsonResponse({ items: tokenAddresses.map((hash, index) => ({
        address: {
          hash,
          name: ['Binance 14', 'Coinbase Custody', 'Kraken Hot Wallet', 'Uniswap V3 Pool', 'Token Owner', 'Whale Wallet', 'Retail Wallet'][index],
          is_contract: index === 3,
          metadata: { tags: index < 3 ? [{ name: ['Binance', 'Coinbase', 'Kraken'][index], slug: ['binance', 'coinbase', 'kraken'][index] }] : [] },
        },
        value: amounts[index],
      })) });
    }
    if (url.includes('/api/v2/tokens/')) {
      return jsonResponse({ decimals: '18', total_supply_raw: totalSupply, total_supply: '10000' });
    }
    if (url.startsWith('https://api.dexscreener.com/')) {
      const tokenAddress = new URL(url).pathname.split('/').at(-1);
      return jsonResponse({ pairs: [{
        chainId: 'ethereum',
        dexId: 'uniswap',
        pairAddress: address.pool,
        baseToken: { address: tokenAddress },
        quoteToken: { address: '0x8888888888888888888888888888888888888888' },
      }] });
    }
    if (url.startsWith('https://api.gopluslabs.io/')) {
      const tokenAddress = new URL(url).searchParams.get('contract_addresses');
      return jsonResponse({ code: 1, result: { [tokenAddress]: {
        is_mintable: '1',
        owner_address: address.owner,
        is_renounced: '0',
        is_honeypot: '0',
        can_take_back_ownership: '0',
      } } });
    }
    if (url.startsWith('https://api.honeypot.is/')) throw new Error('fallback should not run when GoPlus has the field');
    if (options.method === 'POST') throw new Error('public RPC fallback should not run when the explorer has total supply');
    throw new Error(`Unexpected mocked request: ${url}`);
  };
  return { fetchMock, calls, address };
}

function solanaMockFetch() {
  const calls = [];
  const mint = 'So11111111111111111111111111111111111111112';
  const tokenAccounts = ['TokenAccountA', 'TokenAccountB', 'TokenAccountC', 'TokenAccountD'];
  const devAuthority = 'DevAuthority111111111111111111111111111111';
  const freezeAuthority = 'FreezeAuthority111111111111111111111111111';
  const whale = 'WhaleWallet1111111111111111111111111111111';
  const small = 'SmallWallet11111111111111111111111111111111';
  const raydiumPool = 'RaydiumPool1111111111111111111111111111111';

  const fetchMock = async (input, options = {}) => {
    const url = String(input);
    calls.push({ url, method: options.method || 'GET' });
    if (options.method === 'POST') {
      const body = JSON.parse(options.body);
      if (body.method === 'getTokenLargestAccounts') {
        return jsonResponse({ result: { value: [
          { address: tokenAccounts[0], amount: '3000000' },
          { address: tokenAccounts[1], amount: '2000000' },
          { address: tokenAccounts[2], amount: '1000000' },
          { address: tokenAccounts[3], amount: '1000000' },
        ] } });
      }
      if (body.method === 'getAccountInfo') {
        return jsonResponse({ result: { value: { data: { parsed: { info: {
          decimals: 6,
          supply: '10000000',
          mintAuthority: devAuthority,
          freezeAuthority,
        } } } } } });
      }
      if (body.method === 'getMultipleAccounts') {
        return jsonResponse({ result: { value: [
          { data: { parsed: { info: { owner: whale, tokenAmount: { amount: '3000000' } } } } },
          { data: { parsed: { info: { owner: whale, tokenAmount: { amount: '2000000' } } } } },
          { data: { parsed: { info: { owner: devAuthority, tokenAmount: { amount: '1000000' } } } } },
          { data: { parsed: { info: { owner: raydiumPool, tokenAmount: { amount: '1000000' } } } } },
        ] } });
      }
      throw new Error(`Unexpected Solana RPC method: ${body.method}`);
    }
    if (url.startsWith('https://api.dexscreener.com/')) {
      return jsonResponse({ pairs: [{
        chainId: 'solana',
        dexId: 'raydium',
        pairAddress: raydiumPool,
        baseToken: { address: mint },
        quoteToken: { address: 'So11111111111111111111111111111111111111113' },
      }] });
    }
    if (url.startsWith('https://api.gopluslabs.io/')) return jsonResponse({ error: 'unavailable' }, 503);
    throw new Error(`Unexpected mocked Solana request: ${url}`);
  };
  return { fetchMock, calls, mint, devAuthority, freezeAuthority, whale, raydiumPool, small };
}

let checks = 0;
function check(name, condition) {
  assert.ok(condition, name);
  checks += 1;
  console.log(`  PASS  ${name}`);
}

console.log('\n— NodeCluster public data fetcher (mocked/offline) —');
check('canvas paints the exact www.nodechart.cc watermark', source.includes("ctx.fillText('www.nodechart.cc'"));
const cellDrawOrder = source.indexOf('for (const cell of this.cells) this.drawCell(cell, timestamp);');
const watermarkDrawOrder = source.indexOf('this.drawWatermark();', cellDrawOrder);
check('watermark renders above the opaque crystal cells and survives screenshots', cellDrawOrder >= 0 && watermarkDrawOrder > cellDrawOrder);
check('runtime source includes the static PNG export implementation', source.includes('exportPng(options = {})'));

{
  const mock = evmMockFetch();
  const runtime = createRuntime(mock.fetchMock);
  check('browser runtime exposes the PNG export API', typeof runtime.api.exportPng === 'function');
  const tokenAddress = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const token = { id: `ethereum:${tokenAddress}`, symbol: 'TEST', chain: 'ethereum', contract: tokenAddress };
  const canvas = createCanvas();
  const ready = waitForEvent(runtime, 'nodecluster:data-ready', () => runtime.dispatch('nodecluster:mount', {
    canvas, token,
  }));
  await ready;

  const state = runtime.api.getState();
  const holders = state.holders;
  const holder = (value) => holders.find((entry) => entry.address?.toLowerCase() === value.toLowerCase());
  check('mount auto-fetches the active supported token', state.token.id === token.id && state.source === 'blockscout');
  check('desktop rendering reports its adaptive 60 FPS target and high-quality profile', state.performance.targetFps === 60
    && state.performance.quality === 'high' && state.performance.mobileOptimized === false);
  check('renderer owns and registers its canvas, resize, visibility, and observer lifecycle',
    canvas.listenerCount('pointerdown') === 1 && canvas.listenerCount('pointermove') === 1
      && runtime.windowListenerCount('resize') === 1 && runtime.documentListenerCount('visibilitychange') === 1
      && runtime.resizeObservers.length === 1);
  check('named exchanges remain CEX while an indexed Uniswap pair is a distinct non-CEX DEX pool', [
    holder(mock.address.binance)?.classification === 'CEX',
    holder(mock.address.coinbase)?.classification === 'CEX',
    holder(mock.address.kraken)?.classification === 'CEX',
    holder(mock.address.pool)?.classification === 'DEX_POOL',
    holder(mock.address.pool)?.venue === 'DEX',
    holder(mock.address.pool)?.isPool === true,
    holder(mock.address.pool)?.isCex === false,
  ].every(Boolean));
  check('GoPlus owner wallet is classified as developer/risk', holder(mock.address.owner)?.classification === 'DEV_RISK');
  check('whales use a strict >2% supply-share threshold', holder(mock.address.whale)?.classification === 'WHALE'
    && holder(mock.address.standard)?.classification === 'STANDARD');
  check('holder shares are normalized from raw balances against total supply', Math.abs((holder(mock.address.binance)?.sharePct || 0) - 30) < 1e-8);
  check('GoPlus mint, owner, and honeypot fields are retained', state.security.isMintable === true
    && state.security.ownershipRenounced === false && state.security.isHoneypot === false);
  check('top-holder truncation is explicitly reported as partial', state.dataStatus.partial === true
    && state.dataStatus.provider === 'blockscout' && state.dataStatus.note.includes('Top'));
  check('the Voronoi snapshot keeps an unreported-supply Other shard', holders.some((entry) => entry.isOther));
  check('GoPlus completeness avoids unnecessary Honeypot/RPC fallback requests', mock.calls.every(({ url, method }) =>
    !url.startsWith('https://api.honeypot.is/') && method !== 'POST'));

  const callCount = mock.calls.length;
  await runtime.api.fetchTokenData(token);
  check('fresh snapshots are served from memory cache', mock.calls.length === callCount);

  const eventTypes = runtime.events.map((event) => event.type);
  check('data-ready, status, and security events are emitted', eventTypes.includes('nodecluster:data-ready')
    && eventTypes.includes('nodecluster:data-status') && eventTypes.includes('nodecluster:security-update'));
  runtime.api.unmount();
  check('unmount releases renderer listeners, the observer, the animation frame, and touch-action',
    canvas.listenerCount('pointerdown') === 0 && canvas.listenerCount('pointermove') === 0
      && canvas.listenerCount('wheel') === 0 && runtime.windowListenerCount('resize') === 0
      && runtime.documentListenerCount('visibilitychange') === 0 && runtime.frameCount() === 0
      && runtime.resizeObservers[0]?.disconnected === true && canvas.style.touchAction === 'pan-x pan-y');
}

{
  const runtime = createRuntime(async () => { throw new Error('auto-fetch is disabled for export tests'); });
  runtime.api.configure({ autoFetch: false });
  runtime.api.mount({ canvas: createCanvas(), token: { id: 'ethereum:export', symbol: 'EXPORT' }, holders: [
    { address: '0x1111111111111111111111111111111111111111', label: 'HOLDER A', sharePct: 60 },
    { address: '0x2222222222222222222222222222222222222222', label: 'HOLDER B', sharePct: 40 },
  ], source: 'host' });
  const freePng = await runtime.api.exportPng({ scale: 1, watermark: false, brandText: '' });
  const freeCanvas = runtime.exportCanvases.at(-1);
  const freeWatermarks = freeCanvas?.drawCalls.filter((call) => call.text === 'www.nodechart.cc') || [];
  check('direct Free export ignores watermark=false and stamps a semi-transparent diagonal brand grid',
    freePng?.startsWith('data:image/png') && freeWatermarks.length > 1
      && freeWatermarks.every((call) => Math.abs(call.alpha - 0.13) < 1e-8)
      && freeCanvas?.removed === true);

  const proof = {
    chain: 'ethereum', txHash: `0x${'a'.repeat(64)}`, recipient: `0x${'b'.repeat(40)}`,
    amountNative: 0.01, asset: 'ETH', amountUsd: 10, blockTime: 1_700_000_000,
    confirmations: 12, finality: '12 confirmations', verifiedAt: 1_700_000_001,
  };
  runtime.localStorage.setItem('nc-pro-access-v1', JSON.stringify({ state: { proof }, version: 0 }));
  const marker = await makeExportMarker(proof);
  runtime.localStorage.setItem('nc-nodecluster-pro-export-v1', JSON.stringify(marker));
  const proPng = await runtime.api.exportPng({ scale: 2, watermark: false });
  const proCanvas = runtime.exportCanvases.at(-1);
  check('verified local TxHash permits the Pro clean PNG export', proPng?.startsWith('data:image/png')
    && !proCanvas?.drawCalls.some((call) => call.text === 'www.nodechart.cc'));

  runtime.localStorage.setItem('nc-nodecluster-pro-export-v1', JSON.stringify({
    status: 'verified', chain: proof.chain, txHash: `0x${'c'.repeat(64)}`, verifiedAt: proof.verifiedAt,
  }));
  const mismatchedPng = await runtime.api.exportPng({ watermark: false });
  const mismatchedCanvas = runtime.exportCanvases.at(-1);
  check('a mismatched entitlement TxHash fails closed to the Free watermark grid',
    mismatchedPng?.startsWith('data:image/png')
      && (mismatchedCanvas?.drawCalls.filter((call) => call.text === 'www.nodechart.cc').length || 0) > 1);

  runtime.localStorage.setItem('nc-nodecluster-pro-export-v1', JSON.stringify({ ...marker, digest: '0'.repeat(64) }));
  const forgedDigestPng = await runtime.api.exportPng({ watermark: false });
  const forgedDigestCanvas = runtime.exportCanvases.at(-1);
  check('a forged or corrupted Web Crypto digest fails closed to the watermark grid',
    forgedDigestPng?.startsWith('data:image/png')
      && (forgedDigestCanvas?.drawCalls.filter((call) => call.text === 'www.nodechart.cc').length || 0) > 1);
  runtime.api.unmount();
}

{
  const base = evmMockFetch();
  let directFailures = 0;
  let proxySuccesses = 0;
  const runtime = createRuntime((input, options = {}) => {
    const url = String(input);
    if (url.startsWith('/api/proxy/dexscreener?')) {
      proxySuccesses += 1;
      return Promise.resolve(jsonResponse({ pairs: [{
        chainId: 'ethereum', dexId: 'uniswap', pairAddress: '0x4444444444444444444444444444444444444444',
        baseToken: { address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
        quoteToken: { address: '0x8888888888888888888888888888888888888888' },
      }] }));
    }
    if (!url.startsWith('https://api.dexscreener.com/')) return base.fetchMock(input, options);
    directFailures += 1;
    throw new TypeError('simulated browser CORS/TLS failure');
  });
  const proxyToken = { id: 'ethereum:proxy', symbol: 'PROXY', chain: 'ethereum', contract: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' };
  await runtime.api.fetchTokenData(proxyToken);
  check('a direct CORS/TLS failure falls back to the allowlisted same-origin DexScreener proxy',
    directFailures === 2 && proxySuccesses === 1 && runtime.api.getState().dataStatus.dexPairs === 1);
  runtime.api.unmount();
}

{
  const base = evmMockFetch();
  let timeoutAborts = 0;
  let proxyAttempts = 0;
  const runtime = createRuntime((input, options = {}) => {
    const url = String(input);
    if (url.startsWith('/api/proxy/dexscreener?')) {
      proxyAttempts += 1;
      return Promise.reject(new TypeError('proxy network unavailable'));
    }
    if (!url.startsWith('https://api.dexscreener.com/')) return base.fetchMock(input, options);
    return new Promise((_, reject) => {
      const abort = () => {
        timeoutAborts += 1;
        const error = new Error('mock fetch aborted by request timeout');
        error.name = 'AbortError';
        reject(error);
      };
      if (options.signal?.aborted) abort();
      else options.signal?.addEventListener('abort', abort, { once: true });
    });
  });
  runtime.api.configure({ timeoutMs: 1000 });
  const tokenAddress = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const token = { id: `ethereum:${tokenAddress}`, symbol: 'TIMEOUT', chain: 'ethereum', contract: tokenAddress };
  const data = await runtime.api.fetchTokenData(token);
  const state = runtime.api.getState();
  check('DexScreener timeout retries once, then safely handles an unavailable Edge proxy',
    timeoutAborts === 2 && proxyAttempts === 2 && data?.dataStatus.dexPairs === 0
      && state.source === 'blockscout' && state.security.status === 'available');
  runtime.api.unmount();
}

{
  const runtime = createRuntime(async () => { throw new Error('auto-fetch is disabled for FPS tuner tests'); }, {
    devicePixelRatio: 3, innerWidth: 390,
    navigator: { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', maxTouchPoints: 5 },
  });
  runtime.api.configure({ autoFetch: false });
  const canvas = createCanvas();
  runtime.api.mount({ canvas, token: { id: 'ethereum:fps', symbol: 'FPS' }, holders: [
    { address: '0x1111111111111111111111111111111111111111', sharePct: 60 },
    { address: '0x2222222222222222222222222222222222222222', sharePct: 30 },
    { address: '0x3333333333333333333333333333333333333333', sharePct: 10 },
  ], source: 'host' });
  let timestamp = 2000;
  runtime.stepFrame(timestamp);
  for (let index = 0; index < 150; index += 1) {
    timestamp += 1000 / 30;
    runtime.stepFrame(timestamp);
  }
  const performance = runtime.api.getState().performance;
  check('sub-45 FPS sustained for 3 s forces DPR 1, zero shadow blur, and a small particle cap',
    performance.mobilePerformanceFloorApplied && performance.below45DurationMs >= 3000
      && performance.quality === 'low' && performance.shadowScale === 0
      && performance.maxParticles === 18 && canvas.width === 400);
  check('dynamic FPS tuner lowers the render target to 30 FPS when the device remains below 32 FPS',
    performance.targetFps === 30);
  runtime.api.unmount();
}

{
  const runtime = createRuntime(async () => { throw new Error('auto-fetch is disabled for renderer gesture tests'); }, {
    devicePixelRatio: 3,
    innerWidth: 390,
    coarsePointer: true,
    navigator: { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', maxTouchPoints: 5 },
  });
  runtime.api.configure({ autoFetch: false });
  const tokenAddress = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const token = { id: `ethereum:${tokenAddress}`, symbol: 'TOUCH', chain: 'ethereum', contract: tokenAddress };
  const holders = [
    { address: '0x1111111111111111111111111111111111111111', label: 'Wallet A', sharePct: 60 },
    { address: '0x2222222222222222222222222222222222222222', label: 'Wallet B', sharePct: 30 },
    { address: '0x3333333333333333333333333333333333333333', label: 'Wallet C', sharePct: 10 },
  ];
  const canvas = createCanvas();
  runtime.api.mount({ canvas, token, holders, source: 'host' });
  const initial = runtime.api.getState();
  check('iOS/touch viewport selects balanced mobile quality and caps backing-store DPR',
    initial.performance.mobileOptimized && initial.performance.quality === 'balanced'
      && initial.performance.targetFps === 60 && initial.performance.maxCellVertices === 18
      && initial.performance.maxParticles === 84 && canvas.width < 400 * 2.5
      && canvas.dataset.nodeclusterMobileOptimized === 'true');
  const androidRuntime = createRuntime(async () => { throw new Error('auto-fetch is disabled for viewport tests'); }, {
    devicePixelRatio: 3, innerWidth: 412,
    navigator: { userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) Mobile Safari/537.36', maxTouchPoints: 5 },
  });
  androidRuntime.api.configure({ autoFetch: false });
  const androidCanvas = createCanvas();
  androidRuntime.api.mount({ canvas: androidCanvas, token, holders, source: 'host' });
  check('Android touch viewport also selects mobile quality', androidRuntime.api.getState().performance.mobileOptimized
    && androidRuntime.api.getState().performance.quality === 'balanced');
  androidRuntime.api.unmount();

  runtime.stepFrame(1000);
  runtime.stepFrame(1008.3);
  runtime.stepFrame(1016.7);
  check('rAF scheduling caps rendering at 60 FPS on a 120 Hz display', runtime.api.getState().performance.renderedFrames === 2);
  const before144HzFrames = runtime.api.getState().performance.renderedFrames;
  let highRefreshTimestamp = 1016.7;
  for (let index = 0; index < 144; index += 1) {
    highRefreshTimestamp += 1000 / 144;
    runtime.stepFrame(highRefreshTimestamp);
  }
  const renderedAt144Hz = runtime.api.getState().performance.renderedFrames - before144HzFrames;
  check('deadline-based frame pacing stays near 60 FPS on a 144 Hz display', renderedAt144Hz >= 59 && renderedAt144Hz <= 61);

  const dragStart = canvas.dispatchPointer('pointerdown', { pointerId: 11, pointerType: 'touch', clientX: 100, clientY: 100 });
  const dragMove = canvas.dispatchPointer('pointermove', { pointerId: 11, pointerType: 'touch', clientX: 124, clientY: 117 });
  check('single-touch pointer input captures and drags a crystal shard', dragStart.defaultPrevented
    && dragMove.defaultPrevented && canvas.style.cursor === 'grabbing');
  canvas.dispatchPointer('pointerup', { pointerId: 11, pointerType: 'touch', clientX: 124, clientY: 117 });

  canvas.dispatchPointer('pointerdown', { pointerId: 21, pointerType: 'touch', clientX: 120, clientY: 150 });
  canvas.dispatchPointer('pointerdown', { pointerId: 22, pointerType: 'touch', clientX: 280, clientY: 150 });
  const pinchMove = canvas.dispatchPointer('pointermove', { pointerId: 22, pointerType: 'touch', clientX: 320, clientY: 150 });
  const zoomed = runtime.api.getState().performance.zoomScale;
  check('two-finger pinch zoom preserves the view anchor and prevents page gestures', pinchMove.defaultPrevented
    && zoomed > 1.2 && zoomed < 1.3);
  canvas.dispatchPointer('pointerup', { pointerId: 21, pointerType: 'touch', clientX: 120, clientY: 150 });
  canvas.dispatchPointer('pointerup', { pointerId: 22, pointerType: 'touch', clientX: 320, clientY: 150 });

  runtime.setPerformanceStep(20);
  let timestamp = highRefreshTimestamp;
  for (let index = 0; index < 12; index += 1) {
    timestamp += 16.7;
    runtime.stepFrame(timestamp);
  }
  check('sustained over-budget frames trigger lower DPR, fewer particles, and simpler Voronoi edges',
    runtime.api.getState().performance.quality === 'low'
      && runtime.api.getState().performance.maxCellVertices === 10
      && runtime.api.getState().performance.maxParticles === 18
      && runtime.api.getState().performance.shadowScale === 0 && canvas.width === 400);

  runtime.setPerformanceStep(0);
  for (let index = 0; index < 200; index += 1) {
    timestamp += 16.7;
    runtime.stepFrame(timestamp);
  }
  check('quality hysteresis restores the mobile baseline after sustained fast frames',
    runtime.api.getState().performance.quality === 'balanced');
  runtime.api.unmount();
  check('unmount cancels the live animation frame and removes touch/resize/visibility/observer hooks',
    runtime.frameCount() === 0 && canvas.listenerCount('pointerdown') === 0
      && canvas.listenerCount('wheel') === 0 && runtime.windowListenerCount('resize') === 0
      && runtime.documentListenerCount('visibilitychange') === 0
      && runtime.resizeObservers[0]?.disconnected === true && canvas.style.touchAction === 'pan-x pan-y');

  const globalMountListeners = runtime.windowListenerCount('nodecluster:mount');
  for (let cycle = 0; cycle < 3; cycle += 1) {
    const reopenedCanvas = createCanvas();
    runtime.api.mount({ canvas: reopenedCanvas, token, holders, source: 'host' });
    runtime.api.unmount();
    check(`repeated open/close ${cycle + 1} leaves no renderer hooks or animation`,
      reopenedCanvas.listenerCount('pointerdown') === 0 && reopenedCanvas.listenerCount('wheel') === 0
        && runtime.windowListenerCount('resize') === 0 && runtime.documentListenerCount('visibilitychange') === 0
        && runtime.frameCount() === 0);
  }
  check('runtime-level event bridge remains registered exactly once across modal sessions',
    runtime.windowListenerCount('nodecluster:mount') === globalMountListeners && globalMountListeners === 1);
}

{
  const mock = solanaMockFetch();
  const runtime = createRuntime(mock.fetchMock);
  const token = { id: `solana:${mock.mint}`, symbol: 'SOLTEST', chain: 'solana', contract: mock.mint };
  const ready = waitForEvent(runtime, 'nodecluster:data-ready', () => runtime.api.fetchTokenData(token));
  await ready;

  const state = runtime.api.getState();
  const holder = (value) => state.holders.find((entry) => entry.address === value);
  check('Solana largest token accounts are resolved and aggregated by owner', Math.abs((holder(mock.whale)?.sharePct || 0) - 50) < 1e-8);
  check('active Solana mint authority is classified as developer/risk', holder(mock.devAuthority)?.classification === 'DEV_RISK');
  check('DexScreener Raydium pair addresses are explicit DEX pools, never inferred CEX identities',
    holder(mock.raydiumPool)?.classification === 'DEX_POOL' && holder(mock.raydiumPool)?.isPool === true
      && holder(mock.raydiumPool)?.isCex === false && holder(mock.raydiumPool)?.label.toLowerCase().includes('raydium'));
  check('Solana RPC supplies mint and freeze authority security metadata', state.security.isMintable === true
    && state.security.mintAuthority === mock.devAuthority && state.security.freezeAuthority === mock.freezeAuthority);
  check('Solana source and 20-account cap are reported as partial', state.source === 'solana-rpc'
    && state.dataStatus.partial === true && state.dataStatus.holderLimit === 20);
  check('remaining supply is not misrepresented as fully enumerated', state.holders.reduce((sum, row) => sum + row.sharePct, 0) < 100);
  runtime.api.unmount();
}

{
  const owner = '0x9999999999999999999999999999999999999999';
  const ownerResult = `0x${'0'.repeat(24)}${owner.slice(2)}`;
  const calls = [];
  const runtime = createRuntime(async (input, options = {}) => {
    const url = String(input);
    calls.push({ url, method: options.method || 'GET' });
    if (url.includes('/api/v2/tokens/') && url.includes('/holders?')) {
      return jsonResponse({ items: [{ address: { hash: owner, name: 'Owner Wallet' }, value: '100000000000000000000' }] });
    }
    if (url.includes('/api/v2/tokens/')) {
      return jsonResponse({ decimals: '18', total_supply_raw: '1000000000000000000000' });
    }
    if (url.startsWith('https://api.dexscreener.com/')) return jsonResponse({ pairs: [] });
    if (url.startsWith('https://api.gopluslabs.io/')) return jsonResponse({ error: 'rate limited' }, 429);
    if (url.startsWith('https://api.honeypot.is/')) {
      return jsonResponse({ honeypotResult: { isHoneypot: true } });
    }
    if (options.method === 'POST') return jsonResponse({ result: ownerResult });
    throw new Error(`Unexpected fallback request: ${url}`);
  });
  const tokenAddress = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
  const token = { id: `ethereum:${tokenAddress}`, symbol: 'RISK', chain: 'ethereum', contract: tokenAddress };
  const ready = waitForEvent(runtime, 'nodecluster:data-ready', () => runtime.api.fetchTokenData(token));
  await ready;
  const state = runtime.api.getState();
  const wallet = state.holders.find((entry) => entry.address?.toLowerCase() === owner.toLowerCase());
  check('GoPlus rate limits fall back to Honeypot.is and public owner() RPC checks',
    calls.some(({ url }) => url.startsWith('https://api.honeypot.is/'))
      && calls.some(({ method }) => method === 'POST'));
  check('fallback security findings are merged and the owner remains visible as DEV/RISK',
    state.security.isHoneypot === true && state.security.ownershipRenounced === false
      && wallet?.classification === 'DEV_RISK');
  runtime.api.unmount();
}

{
  let started;
  const startedPromise = new Promise((resolve) => { started = resolve; });
  let releaseOld;
  const oldResponse = new Promise((resolve) => { releaseOld = resolve; });
  const oldAddress = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
  const newAddress = '0xcccccccccccccccccccccccccccccccccccccccc';
  const mock = evmMockFetch();
  const baseFetch = mock.fetchMock;
  const fetchMock = async (input, options = {}) => {
    const url = String(input);
    if (url.includes(`/tokens/${oldAddress}/holders?`)) {
      started();
      return oldResponse.then((payload) => jsonResponse(payload));
    }
    return baseFetch(input, options);
  };
  const runtime = createRuntime(fetchMock);
  const oldToken = { id: `ethereum:${oldAddress}`, symbol: 'OLD', chain: 'ethereum', contract: oldAddress };
  const newToken = { id: `ethereum:${newAddress}`, symbol: 'NEW', chain: 'ethereum', contract: newAddress };
  const staleRequest = runtime.api.fetchTokenData(oldToken);
  await startedPromise;
  await runtime.api.fetchTokenData(newToken);
  releaseOld({ items: [{ address: { hash: mock.address.standard, name: 'Late stale holder' }, value: '100000000000000000000' }] });
  await staleRequest;
  check('late results from a superseded token cannot overwrite the active token snapshot',
    runtime.api.getState().token.id === newToken.id && runtime.api.getState().source === 'blockscout');
  const beforeUnsupported = mock.calls.length;
  await runtime.api.fetchTokenData({ id: 'binance:BTC/USDT', symbol: 'BTC/USDT', chain: 'binance' });
  check('CEX symbols fail closed without issuing token-contract requests',
    runtime.api.getDataStatus().status === 'unsupported' && mock.calls.length === beforeUnsupported);
  runtime.api.unmount();
}

{
  let calls = 0;
  const runtime = createRuntime(async () => { calls += 1; throw new Error('auto-fetch should be disabled'); });
  runtime.api.configure({ autoFetch: false });
  runtime.dispatch('nodecluster:token-change', {
    token: { id: 'ethereum:0xdddddddddddddddddddddddddddddddddddddddd', chain: 'ethereum', contract: '0xdddddddddddddddddddddddddddddddddddddddd' },
  });
  check('autoFetch can be explicitly disabled through the public configuration API', calls === 0
    && runtime.api.getDataStatus().status === 'disabled');
  runtime.api.unmount();
}

{
  let calls = 0;
  const runtime = createRuntime(async () => { calls += 1; throw new Error('host data should suppress fetching'); });
  runtime.api.configure({ autoFetch: false });
  const security = { status: 'available', isMintable: true, ownershipRenounced: false, isHoneypot: false };
  const whale = '0xabababababababababababababababababababab';
  runtime.api.setHolders([{ address: whale, label: 'HOST WHALE', sharePct: 4, classification: 'WHALE' }], {
    source: 'host-indexer', security,
  });
  runtime.api.mount({ canvas: createCanvas(), token: {
    id: 'ethereum:0xf1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1',
    symbol: 'HOST', chain: 'ethereum', contract: '0xf1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1',
  } });
  const state = runtime.api.getState();
  check('manual setHolders snapshots mount directly into the Voronoi engine', state.holders.some((row) => row.address === whale)
    && state.security.isMintable === true);
  check('host completeness is not overstated and manual data suppresses auto-fetch', state.dataStatus.partial === true
    && state.dataStatus.note.includes('not verified') && calls === 0);
  runtime.api.unmount();
}

{
  const contract = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const insiderA = '0x1111111111111111111111111111111111111111';
  const insiderB = '0x2222222222222222222222222222222222222222';
  const recipient = '0x3333333333333333333333333333333333333333';
  const exchange = '0x4444444444444444444444444444444444444444';
  const calls = [];
  const runtime = createRuntime(async (input) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith('/fapi/v1/openInterest?symbol=TESTUSDT')) return jsonResponse({ openInterest: '1000' });
    if (url.endsWith('/fapi/v1/depth?symbol=TESTUSDT&limit=100')) {
      return jsonResponse({ bids: [['90.4', '5'], ['96.4', '4']], asks: [['109.6', '5'], ['103.6', '4']] });
    }
    if (url.endsWith('/fapi/v1/premiumIndex?symbol=TESTUSDT')) return jsonResponse({ markPrice: '100' });
    throw new Error(`Unexpected NodeCluster visual-layer request: ${url}`);
  });
  runtime.api.configure({ binanceFuturesBaseUrl: 'https://mock-binance.test', liquidationPollMs: 15_000 });
  const token = { id: `ethereum:${contract}`, symbol: 'TEST/USDT', base: 'TEST', chain: 'ethereum', contract };
  runtime.api.mount({
    canvas: createCanvas(),
    token,
    layers: { liquidationHeatmap: false },
    holders: [
      { address: insiderA, label: 'INSIDER A', sharePct: 11, classification: 'INSIDER' },
      { address: insiderB, label: 'UNLOCKED B', sharePct: 10, classification: 'UNLOCKED' },
      { address: recipient, label: 'RECIPIENT', sharePct: 4 },
      { address: exchange, label: 'EXCHANGE', sharePct: 5, venue: 'CEX' },
    ],
  });

  check('Binance-derived heatmap is opt-in and makes no request until enabled',
    runtime.api.getState().layers.liquidationHeatmap === false && calls.length === 0);
  check('insider and unlocked shares above 20% activate the nebula state',
    runtime.api.getState().insiderSharePct === 21 && runtime.api.getState().insiderNebulaActive === true);
  const flowAccepted = runtime.api.pushTransaction({
    fromAddress: insiderA, toAddress: recipient, amountUsd: 42_000, timestamp: Date.now(), txHash: '0xflow',
  });
  const flow = runtime.api.getState().flowEdges[0];
  check('wallet flow records sender-to-recipient direction and recent activity speed',
    flowAccepted && flow.fromAddress === insiderA && flow.toAddress === recipient && flow.speedPxPerSecond > 100);
  check('CEX wallets remain marked for their cyan/blue shield renderer',
    runtime.api.getState().holders.find((holder) => holder.address === exchange)?.isCex === true);

  const rejectedAlert = runtime.api.setMevAlert({
    type: 'sandwich', source: 'mock detector', pairAddress: '0xpair', pendingTxHash: '0xtx',
    status: 'pending', confidence: 0.64, tokenAddress: contract,
  });
  check('MEV warnings reject pair-like signals lacking a high-confidence/credible signal',
    rejectedAlert === false && runtime.api.getState().mevAlert === null);
  const acceptedAlert = runtime.api.setMevAlert({
    type: 'sandwich', source: 'mock detector', pairAddress: '0xpair', pendingTxHash: '0xtx',
    status: 'pending', confidence: 0.95, tokenAddress: contract, timestamp: Date.now(), expiresInMs: 30_000,
  });
  check('credible token-matched pending pair signals reach the MEV overlay',
    acceptedAlert && runtime.api.getState().mevAlert?.pairAddress === '0xpair');

  const heatmapUpdate = waitForEvent(runtime, 'nodecluster:liquidation-update', () => {
    runtime.api.setLayers({ liquidationHeatmap: true });
  });
  await heatmapUpdate;
  const heatmap = runtime.api.getState().liquidationHeatmap;
  check('Binance Futures OI, depth, and premium index build an explicitly estimated heatmap',
    calls.length === 3 && heatmap.status === 'available' && heatmap.estimated === true
      && heatmap.symbol === 'TESTUSDT' && heatmap.levels.length === 8);
  check('liquidation rows contain both modeled Long and Short zones',
    heatmap.levels.filter((level) => level.side === 'long').length === 4
      && heatmap.levels.filter((level) => level.side === 'short').length === 4);
  check('the heatmap disclaims actual liquidation positions and exposes its split assumption',
    heatmap.assumptions.includes('not liquidation-price pools') && heatmap.assumptions.includes('50/50'));
  runtime.api.setLayers({ showDevRisks: false });
  check('turning off the risk layer suppresses nebula state without affecting token data',
    runtime.api.getState().insiderNebulaActive === false && runtime.api.getState().insiderSharePct === 21);
  runtime.api.unmount();
  check('unmount clears the Binance polling interval', runtime.intervals.size === 0);
}

console.log(`\n✔ NodeCluster mocked smoke OK (${checks} assertions)\n`);
