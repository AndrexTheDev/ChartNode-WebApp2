/*
 * NodeCluster · Voronoi Crystal Engine
 * ------------------------------------
 * Standalone canvas renderer and best-effort public-chain data adapter. It has
 * no package dependencies or embedded API keys. Public RPC/indexer requests
 * auto-start for a valid active DEX token (`autoFetch` defaults to true) and
 * can be disabled with `window.NodeCluster.configure({ autoFetch: false })`.
 * Blockscout holder access varies by explorer; Etherscan/Solscan paid holder
 * endpoints are not treated as free fallbacks. Solana public RPC returns at
 * most 20 largest token accounts. No wallet scraping occurs.
 * Host snapshots and wallet-linked transactions can still be supplied through
 * window.NodeCluster.setData()/pushTransaction or the matching window events.
 * Wallet-to-wallet flows require both endpoints in the visible holder snapshot.
 * MEV alerts are accepted only as externally supplied, pair-specific pending
 * sandwich/front-run signals matching the active DEX token. A signal must name
 * its source, pair, pending transaction, activity type and token, plus
 * `credible: true` or numeric confidence >= 0.85; this file does not claim to
 * scan a public EVM/Solana mempool. Heatmap zones are
 * estimates modeled from Binance USDⓈ-M aggregate OI and order-book depth, not
 * exchange-reported liquidation positions.
 *
 * Holder input shape:
 *   { address, label?, sharePct, venue?, risk?, isInsider?, isUnlocked? }
 * `sharePct` is a percentage of total token supply (0..100), not a fraction.
 * Until real data is supplied, the engine uses clearly watermarked demo data.
 */
(() => {
  'use strict';

  const RUNTIME_KEY = '__NODECLUSTER_VORONOI_CRYSTAL__';
  const VERSION = '1.3.0';
  const MAX_SHARDS = 36;
  const TAU = Math.PI * 2;
  const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
  const PALETTE = [
    { core: '#39FF14', light: '#CAFFB8', dark: '#092D0B' },
    { core: '#FF007F', light: '#FFC0DD', dark: '#3D0825' },
    { core: '#9D00FF', light: '#E3B8FF', dark: '#25063C' },
    { core: '#73FF5F', light: '#E2FFD9', dark: '#0D3218' },
  ];
  const DEFAULT_LAYERS = {
    highlightWhales: true,
    showDevRisks: true,
    mevOverlay: true,
    hideCex: false,
    liquidationHeatmap: false,
  };
  const MAX_FETCH_HOLDERS = 50;
  const REQUEST_TIMEOUT_MS = 3000;
  const MAX_REQUEST_RETRIES = 1;
  const FETCH_CACHE_MS = 45_000;
  const BINANCE_LIQUIDATION_POLL_MS = 30_000;
  const FLOW_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
  const INSIDER_NEBULA_THRESHOLD_PCT = 20;
  const TARGET_FPS = 60;
  const MOBILE_FPS_FLOOR = 45;
  const MOBILE_SLOW_FRAME_MS = (1000 / MOBILE_FPS_FLOOR) * 1.01;
  const PERFORMANCE_QUALITY = [
    {
      name: 'high', maxDpr: 2.5, maxParticles: 240, particleBurst: 28,
      maxCellVertices: 0, facetStride: 1, seamStride: 2, maxFlowEdges: 32,
      balanceEvery: 7, initialBalanceIterations: 22, resizeBalanceIterations: 20,
      shadowScale: 1, gridStep: 42,
    },
    {
      name: 'balanced', maxDpr: 1.45, maxParticles: 84, particleBurst: 12,
      maxCellVertices: 18, facetStride: 2, seamStride: 4, maxFlowEdges: 14,
      balanceEvery: 10, initialBalanceIterations: 10, resizeBalanceIterations: 8,
      shadowScale: 0.62, gridStep: 54,
    },
    {
      name: 'low', maxDpr: 1, maxParticles: 18, particleBurst: 2,
      maxCellVertices: 10, facetStride: 3, seamStride: 6, maxFlowEdges: 4,
      balanceEvery: 18, initialBalanceIterations: 4, resizeBalanceIterations: 4,
      shadowScale: 0, gridStep: 76,
    },
  ];
  const LIQUIDATION_LEVERAGES = [10, 25, 50, 100];
  const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

  // Keyless public RPCs and Blockscout instances. Coverage varies by chain and
  // provider policy; unknown chains fail closed instead of inventing holders.
  const CHAIN_CONFIG = {
    ethereum: {
      chainId: 1, dexId: 'ethereum', aliases: ['eth', 'mainnet', 'ethereum-mainnet'],
      explorers: ['https://eth.blockscout.com'],
      rpcs: ['https://ethereum-rpc.publicnode.com', 'https://eth.llamarpc.com'],
    },
    base: {
      chainId: 8453, dexId: 'base', aliases: [],
      explorers: ['https://base.blockscout.com'],
      rpcs: ['https://base-rpc.publicnode.com', 'https://base.llamarpc.com'],
    },
    arbitrum: {
      chainId: 42161, dexId: 'arbitrum', aliases: ['arbitrum-one', 'arb'],
      explorers: ['https://arbitrum.blockscout.com'],
      rpcs: ['https://arbitrum-one-rpc.publicnode.com', 'https://arbitrum.llamarpc.com'],
    },
    optimism: {
      chainId: 10, dexId: 'optimism', aliases: ['op'],
      explorers: ['https://optimism.blockscout.com'],
      rpcs: ['https://optimism-rpc.publicnode.com', 'https://optimism.llamarpc.com'],
    },
    polygon: {
      chainId: 137, dexId: 'polygon', aliases: ['matic', 'polygon-pos'],
      explorers: ['https://polygon.blockscout.com'],
      rpcs: ['https://polygon-bor-rpc.publicnode.com', 'https://polygon.llamarpc.com'],
    },
    bsc: {
      chainId: 56, dexId: 'bsc', aliases: ['bnb', 'binance-smart-chain', 'bnb-chain'],
      explorers: ['https://bnb.blockscout.com'],
      rpcs: ['https://bsc-rpc.publicnode.com', 'https://binance.llamarpc.com'],
    },
    avalanche: {
      chainId: 43114, dexId: 'avalanche', aliases: ['avax', 'avalanche-c-chain'],
      explorers: ['https://avalanche.blockscout.com'],
      rpcs: ['https://avalanche-c-chain-rpc.publicnode.com'],
    },
    gnosis: {
      chainId: 100, dexId: 'gnosis', aliases: ['xdai'],
      explorers: ['https://gnosis.blockscout.com'],
      rpcs: ['https://gnosis-rpc.publicnode.com', 'https://rpc.gnosischain.com'],
    },
    celo: {
      chainId: 42220, dexId: 'celo', aliases: [],
      explorers: ['https://celo.blockscout.com'],
      rpcs: ['https://forno.celo.org'],
    },
    scroll: {
      chainId: 534352, dexId: 'scroll', aliases: [],
      explorers: ['https://scroll.blockscout.com'],
      rpcs: ['https://rpc.scroll.io'],
    },
    linea: {
      chainId: 59144, dexId: 'linea', aliases: [],
      explorers: ['https://linea.blockscout.com'],
      rpcs: ['https://rpc.linea.build'],
    },
    solana: {
      chainId: 'solana', dexId: 'solana', aliases: ['sol', 'solana-mainnet'],
      rpcs: ['https://api.mainnet-beta.solana.com', 'https://solana-rpc.publicnode.com'],
    },
  };
  const DEFAULT_FETCH_CONFIG = {
    autoFetch: true,
    maxHolders: MAX_FETCH_HOLDERS,
    timeoutMs: REQUEST_TIMEOUT_MS,
    cacheMs: FETCH_CACHE_MS,
    goplusAccessToken: '',
    solanaRpcUrls: [],
    evmRpcUrls: {},
    blockscoutHosts: {},
    binanceFuturesBaseUrl: 'https://fapi.binance.com',
    liquidationPollMs: BINANCE_LIQUIDATION_POLL_MS,
  };

  if (window[RUNTIME_KEY]) {
    window.dispatchEvent(new CustomEvent('nodecluster:runtime-ready', {
      detail: { version: VERSION, canvasId: 'nodecluster-canvas' },
    }));
    return;
  }

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const finite = (value, fallback = 0) => {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  };
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

  function hashString(value) {
    let hash = 2166136261;
    const text = String(value ?? 'node');
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function seededRandom(seed) {
    let state = seed >>> 0 || 1;
    return () => {
      state += 0x6D2B79F5;
      let value = state;
      value = Math.imul(value ^ (value >>> 15), value | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
  }

  let fetchConfig = { ...DEFAULT_FETCH_CONFIG };
  let rpcRequestId = 0;
  let fetchStatus = { status: 'idle', source: null, chain: null, tokenId: null, note: null, updatedAt: null };
  let fetchSequence = 0;
  let activeFetch = null;
  let lastDataTokenKey = null;
  let liquidationTimer = null;
  let liquidationController = null;
  let liquidationSequence = 0;
  const fetchCache = new Map();

  function resolveChain(token) {
    const raw = String(token?.chain ?? token?.chainId ?? token?.network ?? token?.id?.split(':')?.[1] ?? '')
      .trim().toLowerCase();
    if (!raw) return null;
    for (const [key, config] of Object.entries(CHAIN_CONFIG)) {
      if (key === raw || config.aliases.includes(raw) || String(config.chainId) === raw) {
        return { key, ...config };
      }
    }
    return null;
  }

  function tokenAddress(token) {
    return String(token?.contract ?? token?.mint ?? token?.address ?? '').trim();
  }

  function isValidAddress(address, chainKey) {
    if (chainKey === 'solana') return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);
    return /^0x[a-fA-F0-9]{40}$/.test(address);
  }

  function abortError() {
    const error = new Error('Request aborted');
    error.name = 'AbortError';
    return error;
  }

  // SHA-256 + per-verification random salt is a tamper-evident UX check, not
  // DRM: both the salt and public client code remain inspectable/editable.
  async function hasVerifiedProExportEntitlement() {
    try {
      const saved = JSON.parse(window.localStorage?.getItem('nc-pro-access-v1') || 'null');
      const proof = saved?.state?.proof;
      const marker = JSON.parse(window.localStorage?.getItem('nc-nodecluster-pro-export-v1') || 'null');
      if (!proof || !marker || marker.version !== 1 || marker.status !== 'verified') return false;
      const chain = String(proof.chain || '');
      const txHash = String(proof.txHash || '').trim();
      const validHash = chain === 'ethereum' ? /^0x[\da-f]{64}$/i.test(txHash)
        : chain === 'bitcoin' ? /^[\da-f]{64}$/i.test(txHash)
          : chain === 'solana' ? /^[1-9A-HJ-NP-Za-km-z]{64,100}$/.test(txHash) : false;
      const salt = String(marker.salt || '');
      const savedDigest = String(marker.digest || '').toLowerCase();
      if (!validHash || !/^[\da-f]{32}$/i.test(salt) || !/^[\da-f]{64}$/.test(savedDigest)
        || String(marker.chain || '') !== chain
        || String(marker.txHash || '').toLowerCase() !== txHash.toLowerCase()
        || Number(marker.verifiedAt) !== Number(proof.verifiedAt)
        || Number(proof.amountUsd) < 5 || !Number.isFinite(Number(proof.verifiedAt))
        || Number(proof.verifiedAt) <= 0 || !window.crypto?.subtle) return false;

      const payload = [
        'nodechart-pro-export-v1', chain, txHash.toLowerCase(), String(Number(proof.verifiedAt)),
        String(Number(proof.amountUsd)), String(proof.recipient || '').trim().toLowerCase(),
        String(Number(proof.amountNative)), String(Number(proof.blockTime)), String(proof.asset || ''), salt,
      ].join('|');
      const digest = await window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload));
      const actualDigest = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
      return actualDigest === savedDigest;
    } catch {
      return false;
    }
  }

  async function requestJsonWithRetries(url, options = {}, signal = null) {
    if (typeof fetch !== 'function') throw new Error('Fetch API unavailable');
    const timeout = Math.max(1000, finite(fetchConfig.timeoutMs, REQUEST_TIMEOUT_MS));
    let lastError = null;

    for (let attempt = 0; attempt <= MAX_REQUEST_RETRIES; attempt += 1) {
      if (signal?.aborted) throw abortError();
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), timeout);
      const relayAbort = () => controller.abort();
      signal?.addEventListener('abort', relayAbort, { once: true });
      try {
        const response = await fetch(url, {
          ...options,
          signal: controller.signal,
          credentials: 'omit',
          cache: String(url).startsWith('/api/proxy/') ? 'default' : 'no-store',
        });
        if (signal?.aborted) throw abortError();
        if (controller.signal.aborted) {
          const timeoutError = new Error(`Request timed out after ${timeout}ms`);
          timeoutError.name = 'TimeoutError';
          throw timeoutError;
        }
        if (!response.ok) {
          await response.body?.cancel?.().catch(() => {});
          const error = new Error(`HTTP ${response.status}`);
          error.status = response.status;
          throw error;
        }
        let payload;
        try { payload = await response.json(); }
        catch {
          if (signal?.aborted) throw abortError();
          if (controller.signal.aborted) {
            const timeoutError = new Error(`Request timed out after ${timeout}ms`);
            timeoutError.name = 'TimeoutError';
            throw timeoutError;
          }
          throw new Error(`Invalid JSON response (${response.status})`);
        }
        if (signal?.aborted) throw abortError();
        if (controller.signal.aborted) {
          const timeoutError = new Error(`Request timed out after ${timeout}ms`);
          timeoutError.name = 'TimeoutError';
          throw timeoutError;
        }
        return payload;
      } catch (error) {
        if (signal?.aborted) throw abortError();
        const status = Number(error?.status);
        const retryable = controller.signal.aborted || error?.name === 'TypeError'
          || status === 429 || (status >= 500 && status <= 599);
        if (!retryable || attempt >= MAX_REQUEST_RETRIES) {
          if (controller.signal.aborted) {
            const timeoutError = new Error(`Request timed out after ${timeout}ms`);
            timeoutError.name = 'TimeoutError';
            throw timeoutError;
          }
          throw error;
        }
        lastError = error;
      } finally {
        window.clearTimeout(timer);
        signal?.removeEventListener('abort', relayAbort);
      }
    }
    throw lastError || new Error('Public API request failed');
  }

  function buildProxyFallbackUrl(rawUrl, options = {}) {
    let target;
    try { target = new URL(rawUrl, window.location?.origin || 'https://nodechart.cc'); }
    catch { return null; }
    if (target.protocol !== 'https:') return null;
    const proxy = (provider, values) => {
      const endpoint = new URL(`/api/proxy/${provider}`, window.location?.origin || 'https://nodechart.cc');
      for (const [key, value] of Object.entries(values)) endpoint.searchParams.set(key, String(value));
      return `${endpoint.pathname}${endpoint.search}`;
    };

    if (target.hostname === 'api.dexscreener.com') {
      const match = target.pathname.match(/^\/latest\/dex\/tokens\/([^/]+)$/);
      if (!match) return null;
      let address;
      try { address = decodeURIComponent(match[1]); } catch { return null; }
      return proxy('dexscreener', { address });
    }

    if (target.hostname === 'api.gopluslabs.io') {
      const address = target.searchParams.get('contract_addresses') || '';
      const solanaPath = target.pathname === '/api/v1/solana/token_security';
      const chainMatch = target.pathname.match(/^\/api\/v1\/token_security\/(\d+)$/);
      const chain = solanaPath ? 'solana' : chainMatch
        ? Object.entries(CHAIN_CONFIG).find(([, config]) => String(config.chainId) === chainMatch[1])?.[0]
        : null;
      if (!chain || !address) return null;
      return proxy('goplus', { chain, address });
    }

    if (target.hostname === 'mempool.space') {
      const endpointByPath = {
        '/api/mempool': 'mempool',
        '/api/v1/fees/recommended': 'fees',
        '/api/v1/difficulty-adjustment': 'difficulty',
      };
      const endpoint = endpointByPath[target.pathname];
      return endpoint ? proxy('mempool', { endpoint }) : null;
    }

    if (target.hostname === 'api.honeypot.is' && target.pathname === '/v2/IsHoneypot') {
      const address = target.searchParams.get('address') || '';
      const chainId = target.searchParams.get('chainID') || '';
      return address && chainId ? proxy('honeypot', { address, chainId }) : null;
    }

    if (target.hostname.endsWith('.blockscout.com')) {
      const chain = Object.entries(CHAIN_CONFIG).find(([, config]) =>
        config.explorers?.some((host) => new URL(host).hostname === target.hostname))?.[0];
      const match = target.pathname.match(/^\/api\/v2\/tokens\/(0x[a-fA-F0-9]{40})(?:\/(holders))?$/);
      if (!chain || !match) return null;
      const resource = match[2] ? 'holders' : 'token';
      return proxy('blockscout', {
        chain,
        address: match[1],
        resource,
        ...(resource === 'holders' ? { count: target.searchParams.get('items_count') || MAX_FETCH_HOLDERS } : {}),
      });
    }

    if (target.hostname === 'fapi.binance.com') {
      const endpointByPath = {
        '/fapi/v1/openInterest': 'openInterest',
        '/fapi/v1/depth': 'depth',
        '/fapi/v1/premiumIndex': 'premiumIndex',
      };
      const endpoint = endpointByPath[target.pathname];
      const symbol = target.searchParams.get('symbol') || '';
      return endpoint && symbol ? proxy('binancefutures', { endpoint, symbol }) : null;
    }

    const method = String(options.method || 'GET').toUpperCase();
    if (method === 'POST') {
      const knownRpcHost = Object.values(CHAIN_CONFIG).some((config) =>
        config.rpcs?.some((rpc) => new URL(rpc).hostname === target.hostname));
      if (knownRpcHost && target.pathname === '/') return proxy('rpc', { endpoint: target.hostname });
    }
    return null;
  }

  function isProxyRetryable(error) {
    const status = Number(error?.status);
    return error?.name === 'TypeError' || error?.name === 'TimeoutError'
      || status === 429 || (status >= 500 && status <= 599);
  }

  async function requestJson(url, options = {}, signal = null) {
    try {
      return await requestJsonWithRetries(url, options, signal);
    } catch (error) {
      if (signal?.aborted || !isProxyRetryable(error)) throw error;
      const fallbackUrl = buildProxyFallbackUrl(url, options);
      if (!fallbackUrl) throw error;
      try {
        return await requestJsonWithRetries(fallbackUrl, options, signal);
      } catch (proxyError) {
        if (signal?.aborted) throw abortError();
        throw proxyError;
      }
    }
  }

  async function rpcJson(url, method, params, signal) {
    const response = await requestJson(url, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcRequestId, method, params }),
    }, signal);
    if (response?.error) throw new Error(`RPC ${method}: ${response.error.message || 'request failed'}`);
    if (response?.result === undefined) throw new Error(`RPC ${method}: missing result`);
    return response.result;
  }

  function parseFlag(value) {
    if (typeof value === 'boolean') return value;
    if (value == null) return null;
    const normalized = String(value).trim().toLowerCase();
    if (['1', 'true', 'yes', 'enabled', 'active'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'disabled', 'inactive', ''].includes(normalized)) return false;
    return null;
  }

  function parseInteger(value) {
    try {
      if (typeof value === 'bigint') return value >= 0n ? value : 0n;
      if (typeof value === 'number' && Number.isFinite(value)) return BigInt(Math.max(0, Math.trunc(value)));
      const text = String(value ?? '').trim();
      if (/^0x[0-9a-f]+$/i.test(text)) return BigInt(text);
      if (/^\d+$/.test(text)) return BigInt(text);
    } catch { /* malformed explorer values are ignored */ }
    return null;
  }

  function decimalToUnits(value, decimals) {
    const text = String(value ?? '').trim().replace(/,/g, '');
    if (!/^\d+(?:\.\d+)?$/.test(text)) return null;
    const precision = clamp(Math.trunc(finite(decimals, 0)), 0, 36);
    const [whole, fraction = ''] = text.split('.');
    const base = 10n ** BigInt(precision);
    const fractional = (fraction.slice(0, precision).padEnd(precision, '0') || '0');
    try { return BigInt(whole || '0') * base + BigInt(fractional); }
    catch { return null; }
  }

  function shareFromRaw(balance, supply) {
    if (balance == null || supply == null || supply <= 0n || balance <= 0n) return 0;
    const scale = 1_000_000n;
    return Number((balance * 100n * scale) / supply) / Number(scale);
  }

  function boundedText(value, limit = 64) {
    return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, limit);
  }

  function uniqueUrls(primary, additional) {
    return [...new Set([...(Array.isArray(primary) ? primary : []), ...(Array.isArray(additional) ? additional : [])]
      .map((url) => String(url || '').replace(/\/+$/, ''))
      .filter((url) => /^https:\/\//i.test(url)))];
  }

  const DEMO_HOLDERS = [
    { address: '0x7a3f…19c2', label: 'VAULT 01', sharePct: 22.8, risk: false },
    { address: '0x94de…a08b', label: 'COLD 02', sharePct: 16.4, risk: false },
    { address: '0x0bc1…d733', label: 'WHALE 03', sharePct: 12.1, risk: false },
    { address: '0x5ef0…804a', label: 'ROUTER 04', sharePct: 9.2, venue: 'CEX' },
    { address: '0xad61…e3f0', label: 'WHALE 05', sharePct: 7.3, risk: false },
    { address: '0x2f87…bb15', label: 'LP 06', sharePct: 6.0 },
    { address: '0xd4b9…3a61', label: 'WALLET 07', sharePct: 4.8 },
    { address: '0x81c5…60fe', label: 'ROUTER 08', sharePct: 4.0, venue: 'CEX' },
    { address: '0x3a0d…cf21', label: 'WALLET 09', sharePct: 3.3 },
    { address: '0x711e…cc44', label: 'LP 10', sharePct: 2.8 },
    { address: '0xa5b2…5a9e', label: 'WALLET 11', sharePct: 2.3 },
    { address: '0xc8f6…102d', label: 'WALLET 12', sharePct: 1.9 },
    { address: '0x016c…9d8a', label: 'WALLET 13', sharePct: 1.5 },
    { address: '0xe71a…4670', label: 'WALLET 14', sharePct: 1.2 },
    { address: '0x9f54…a2c6', label: 'WALLET 15', sharePct: 0.9 },
    { address: '0x6c33…ec80', label: 'WALLET 16', sharePct: 0.7 },
    { address: '0x5512…b91f', label: 'WALLET 17', sharePct: 0.5 },
    { address: '0x4e02…128c', label: 'WALLET 18', sharePct: 0.4 },
  ];

  function readShare(holder) {
    if (!holder || typeof holder !== 'object') return 0;
    const explicit = holder.sharePct ?? holder.percent ?? holder.supplyPct;
    if (explicit != null) return Math.max(0, finite(explicit));
    const share = Math.max(0, finite(holder.share));
    // `share` alone may be supplied as a 0..1 fraction; explicit percent keys
    // always remain percentages (so sharePct: 0.4 correctly means 0.4%).
    return share > 0 && share <= 1 ? share * 100 : share;
  }

  function normalizeHolders(input, source) {
    const totalSupplyPct = Math.max(0.01, finite(input?.totalSupplyPct, 100));
    const raw = Array.isArray(input?.holders) ? input.holders : [];
    const rows = raw
      .map((holder, index) => {
        const address = String(holder?.address ?? holder?.id ?? `holder-${index + 1}`);
        const sharePct = readShare(holder);
        if (sharePct <= 0) return null;
        const venue = String(holder?.venue ?? (holder?.isCex ? 'CEX' : holder?.type ?? '')).toUpperCase();
        const classification = String(holder?.classification || 'STANDARD').toUpperCase();
        const isMintable = parseFlag(holder?.isMintable) === true;
        const isHoneypot = parseFlag(holder?.isHoneypot) === true;
        const isPool = Boolean(holder?.isPool) || ['POOL', 'DEX_POOL'].includes(classification) || venue === 'DEX';
        const isUnlocked = parseFlag(holder?.isUnlocked ?? holder?.unlocked) === true || classification === 'UNLOCKED';
        const isInsider = parseFlag(holder?.isInsider ?? holder?.insider) === true
          || ['DEV_RISK', 'INSIDER'].includes(classification);
        return {
          id: address.toLowerCase(),
          address,
          label: boundedText(holder?.label ?? holder?.name ?? address, 64),
          sharePct,
          venue,
          classification,
          confidence: boundedText(holder?.confidence || 'unverified', 24),
          isCex: !isPool && (Boolean(holder?.isCex) || classification === 'CEX' || venue === 'CEX' || venue === 'CENTRALIZED'),
          isPool,
          isOther: Boolean(holder?.isOther),
          isInsider,
          isUnlocked,
          risk: Boolean(holder?.risk || isMintable || isHoneypot || isUnlocked || isInsider || ['DEV_RISK', 'INSIDER', 'UNLOCKED'].includes(classification)),
          isMintable,
          isHoneypot,
          riskReasons: Array.isArray(holder?.riskReasons) ? holder.riskReasons.map((item) => boundedText(item, 48)).slice(0, 5) : [],
          tags: Array.isArray(holder?.tags) ? holder.tags.map((item) => boundedText(item, 32)).slice(0, 8) : [],
          source,
        };
      })
      .filter(Boolean)
      .sort((a, b) => b.sharePct - a.sharePct);

    if (rows.length === 0) {
      return [{
        id: 'other-holders', address: 'other', label: 'OTHER HOLDERS',
        sharePct: totalSupplyPct, venue: '', isCex: false, isOther: true,
        risk: false, isMintable: false, isHoneypot: false, source,
      }];
    }

    const total = rows.reduce((sum, row) => sum + row.sharePct, 0);
    if (total > totalSupplyPct) {
      const scale = totalSupplyPct / total;
      for (const row of rows) row.sharePct *= scale;
    }

    const kept = rows.slice(0, MAX_SHARDS - 1);
    const keptTotal = kept.reduce((sum, row) => sum + row.sharePct, 0);
    const residual = Math.max(0, totalSupplyPct - keptTotal);
    if (residual > 0.001) {
      kept.push({
        id: 'other-holders',
        address: 'other',
        label: rows.length > kept.length ? 'OTHER / HIDDEN' : 'OTHER HOLDERS',
        sharePct: residual,
        venue: '',
        isCex: false,
        isOther: true,
        risk: false,
        isMintable: false,
        isHoneypot: false,
        source,
      });
    }

    const keptTotalFinal = kept.reduce((sum, row) => sum + row.sharePct, 0);
    // Correct floating-point residue so target cell areas sum exactly to the
    // requested supply total.
    if (kept.length > 0 && Math.abs(keptTotalFinal - totalSupplyPct) > 1e-7) {
      kept[kept.length - 1].sharePct += totalSupplyPct - keptTotalFinal;
    }
    return kept;
  }

  async function rpcFallback(urls, method, params, signal) {
    let lastError = null;
    for (const url of urls) {
      try { return { result: await rpcJson(url, method, params, signal), url }; }
      catch (error) {
        if (signal?.aborted) throw abortError();
        lastError = error;
      }
    }
    throw lastError || new Error(`No public RPC is configured for ${method}`);
  }

  async function fetchDexScreenerPairs(chain, address, signal) {
    const url = `https://api.dexscreener.com/latest/dex/tokens/${encodeURIComponent(address)}`;
    const payload = await requestJson(url, { headers: { Accept: 'application/json' } }, signal);
    const pairs = Array.isArray(payload?.pairs) ? payload.pairs : [];
    const matching = pairs.filter((pair) => {
      const chainMatches = String(pair?.chainId || '').toLowerCase() === String(chain.dexId).toLowerCase();
      const addressMatches = [pair?.baseToken?.address, pair?.quoteToken?.address]
        .some((candidate) => String(candidate || '').toLowerCase() === address.toLowerCase());
      return chainMatches && addressMatches;
    });
    return {
      pairs: matching.slice(0, 30),
      poolAddresses: new Map(matching
        .filter((pair) => pair?.pairAddress)
        .map((pair) => [String(pair.pairAddress).toLowerCase(), boundedText(pair.dexId || 'DEX', 24)])),
      provider: 'dexscreener',
    };
  }

  async function fetchSolanaHolders(address, chain, signal) {
    const rpcUrls = uniqueUrls(chain.rpcs, fetchConfig.solanaRpcUrls);
    if (rpcUrls.length === 0) throw new Error('No public Solana RPC endpoint configured');

    const [largestResponse, mintResponse] = await Promise.all([
      rpcFallback(rpcUrls, 'getTokenLargestAccounts', [address, { commitment: 'confirmed' }], signal),
      rpcFallback(rpcUrls, 'getAccountInfo', [address, { encoding: 'jsonParsed', commitment: 'confirmed' }], signal),
    ]);
    const largest = Array.isArray(largestResponse.result?.value) ? largestResponse.result.value : [];
    const mintInfo = mintResponse.result?.value?.data?.parsed?.info || null;
    let decimals = clamp(Math.trunc(finite(mintInfo?.decimals, NaN)), 0, 36);
    let supplyRaw = parseInteger(mintInfo?.supply);

    if (supplyRaw == null || supplyRaw <= 0n || !Number.isFinite(decimals)) {
      const supplyResponse = await rpcFallback(rpcUrls, 'getTokenSupply', [address, { commitment: 'confirmed' }], signal);
      const value = supplyResponse.result?.value;
      supplyRaw = parseInteger(value?.amount);
      if (!Number.isFinite(decimals)) decimals = clamp(Math.trunc(finite(value?.decimals, NaN)), 0, 36);
    }
    if (supplyRaw == null || supplyRaw <= 0n) throw new Error('Solana RPC did not return a valid mint supply');
    if (!largest.length) throw new Error('Solana RPC returned no largest token accounts');

    const accountAddresses = largest.slice(0, 20).map((account) => String(account?.address || '')).filter(Boolean);
    const accountResponse = await rpcFallback(rpcUrls, 'getMultipleAccounts', [
      accountAddresses,
      { encoding: 'jsonParsed', commitment: 'confirmed' },
    ], signal);
    const tokenAccounts = Array.isArray(accountResponse.result?.value) ? accountResponse.result.value : [];
    const balances = new Map();
    const labels = new Map();

    for (let index = 0; index < accountAddresses.length; index += 1) {
      const parsed = tokenAccounts[index]?.data?.parsed?.info;
      const owner = String(parsed?.owner || '').trim();
      if (!owner) continue;
      const amount = parseInteger(parsed?.tokenAmount?.amount ?? largest[index]?.amount);
      if (amount == null || amount <= 0n) continue;
      balances.set(owner, (balances.get(owner) || 0n) + amount);
      labels.set(owner, String(parsed?.ownerName || owner));
    }

    const holders = [...balances.entries()]
      .map(([owner, amount]) => ({
        address: owner,
        label: labels.get(owner) || owner,
        amountRaw: amount.toString(),
        sharePct: shareFromRaw(amount, supplyRaw),
      }))
      .filter((holder) => holder.sharePct > 0)
      .sort((a, b) => b.sharePct - a.sharePct)
      .slice(0, clamp(Math.trunc(finite(fetchConfig.maxHolders, MAX_FETCH_HOLDERS)), 1, 50));

    return {
      holders,
      provider: 'solana-rpc',
      endpoint: largestResponse.url,
      holderLimit: 20,
      partial: true,
      note: 'Solana JSON-RPC getTokenLargestAccounts returns at most 20 token accounts; balances are aggregated by owner.',
      mintInfo: {
        supplyRaw: supplyRaw.toString(),
        decimals,
        mintAuthority: mintInfo?.mintAuthority ? String(mintInfo.mintAuthority) : null,
        freezeAuthority: mintInfo?.freezeAuthority ? String(mintInfo.freezeAuthority) : null,
      },
    };
  }

  async function fetchEvmSupply(chain, address, signal) {
    const rpcUrls = uniqueUrls(chain.rpcs, fetchConfig.evmRpcUrls?.[chain.key]);
    if (rpcUrls.length === 0) throw new Error(`No public RPC endpoint configured for ${chain.key}`);
    let lastError = null;
    for (const url of rpcUrls) {
      try {
        const [supplyHex, decimalsHex] = await Promise.all([
          rpcJson(url, 'eth_call', [{ to: address, data: '0x18160ddd' }, 'latest'], signal),
          rpcJson(url, 'eth_call', [{ to: address, data: '0x313ce567' }, 'latest'], signal),
        ]);
        const supplyRaw = parseInteger(supplyHex);
        const decimalsRaw = parseInteger(decimalsHex);
        const decimals = decimalsRaw == null ? NaN : Number(decimalsRaw);
        if (supplyRaw == null || supplyRaw <= 0n || !Number.isFinite(decimals) || decimals < 0 || decimals > 36) {
          throw new Error('ERC-20 totalSupply/decimals returned invalid values');
        }
        return { supplyRaw, decimals, provider: url };
      } catch (error) {
        if (signal?.aborted) throw abortError();
        lastError = error;
      }
    }
    throw lastError || new Error('Could not read ERC-20 supply from public RPC');
  }

  function blockscoutAddressInfo(item) {
    if (item?.address && typeof item.address === 'object') return item.address;
    return { hash: item?.address_hash || item?.holder || item?.address || '' };
  }

  async function fetchBlockscoutHolders(address, chain, signal) {
    const hosts = uniqueUrls(chain.explorers, fetchConfig.blockscoutHosts?.[chain.key]);
    let lastError = null;
    for (const host of hosts) {
      try {
        const encoded = encodeURIComponent(address);
        const [holderPayload, tokenPayload] = await Promise.all([
          requestJson(`${host}/api/v2/tokens/${encoded}/holders?items_count=${clamp(Math.trunc(finite(fetchConfig.maxHolders, MAX_FETCH_HOLDERS)), 1, 50)}`, {
            headers: { Accept: 'application/json' },
          }, signal),
          requestJson(`${host}/api/v2/tokens/${encoded}`, { headers: { Accept: 'application/json' } }, signal).catch(() => null),
        ]);
        const items = Array.isArray(holderPayload?.items) ? holderPayload.items : [];
        if (items.length === 0) throw new Error('Explorer returned no indexed holders');

        let decimals = clamp(Math.trunc(finite(tokenPayload?.decimals, NaN)), 0, 36);
        let supplyRaw = parseInteger(tokenPayload?.total_supply_raw ?? tokenPayload?.totalSupplyRaw);
        if (supplyRaw == null && Number.isFinite(decimals)) {
          supplyRaw = decimalToUnits(tokenPayload?.total_supply ?? tokenPayload?.totalSupply, decimals);
        }
        let supplyProvider = 'blockscout';
        if (supplyRaw == null || supplyRaw <= 0n || !Number.isFinite(decimals)) {
          const rpcSupply = await fetchEvmSupply(chain, address, signal);
          supplyRaw = rpcSupply.supplyRaw;
          decimals = rpcSupply.decimals;
          supplyProvider = rpcSupply.provider;
        }
        if (supplyRaw == null || supplyRaw <= 0n) throw new Error('Could not read ERC-20 total supply');

        const holders = items.slice(0, 50).map((item) => {
          const addressInfo = blockscoutAddressInfo(item);
          const holderAddress = String(addressInfo.hash || item?.address_hash || '').trim();
          const amount = parseInteger(item?.value ?? item?.balance ?? item?.amount);
          if (!holderAddress || amount == null || amount <= 0n) return null;
          const tags = [
            ...(Array.isArray(addressInfo?.metadata?.tags) ? addressInfo.metadata.tags : []),
            ...(Array.isArray(addressInfo?.public_tags) ? addressInfo.public_tags : []),
          ].map((tag) => typeof tag === 'string'
            ? boundedText(tag, 96)
            : boundedText(`${tag?.name || tag?.label || tag?.display_name || ''} ${tag?.slug || tag?.tag || ''} ${tag?.tagType || tag?.tag_type || ''}`, 96)).filter(Boolean);
          return {
            address: holderAddress,
            label: boundedText(addressInfo.name || addressInfo.ens_domain_name || holderAddress, 64),
            tags,
            isScam: parseFlag(addressInfo.is_scam) === true,
            isContract: parseFlag(addressInfo.is_contract) === true,
            amountRaw: amount.toString(),
            sharePct: shareFromRaw(amount, supplyRaw),
          };
        }).filter((holder) => holder && holder.sharePct > 0);
        if (!holders.length) throw new Error('Explorer holder rows could not be parsed');

        return {
          holders,
          provider: 'blockscout',
          endpoint: host,
          supplyProvider,
          holderLimit: holders.length,
          partial: true,
          note: `Top ${holders.length} indexed holders only; the remaining supply is grouped as Other.`,
        };
      } catch (error) {
        if (signal?.aborted) throw abortError();
        lastError = error;
      }
    }
    throw lastError || new Error(`No public Blockscout holder endpoint for ${chain.key}`);
  }

  function walletTags(holder) {
    const rawTags = Array.isArray(holder?.tags) ? holder.tags : [];
    return [holder?.label, holder?.name, holder?.entity, ...rawTags]
      .map((value) => boundedText(value, 96))
      .filter(Boolean)
      .join(' | ')
      .toLowerCase();
  }

  function isZeroAddress(address) {
    const value = String(address || '').toLowerCase();
    return !value || value === ZERO_ADDRESS || /^0+$/.test(value.replace(/^0x/, ''));
  }

  function classifyWallets(holders, security, dexInfo) {
    const authorityAddresses = new Set([
      security?.ownerAddress,
      security?.creatorAddress,
      security?.mintAuthority,
      security?.freezeAuthority,
      security?.deployerAddress,
    ].filter(Boolean).map((address) => String(address).toLowerCase()));
    const poolAddresses = dexInfo?.poolAddresses || new Map();

    return holders.map((holder) => {
      const address = String(holder.address || '').trim();
      const lowerAddress = address.toLowerCase();
      const tags = walletTags(holder);
      const providerNamedDev = /\b(developer|deployer|creator|team wallet|mint authority|owner wallet)\b/.test(tags);
      const explicitExchange = /\b(binance|coinbase|kraken|okx|bybit|kucoin|htx|gate\.io|crypto\.com|centralized exchange|exchange wallet|exchange deposit|deposit wallet|cex)\b/.test(tags);
      const namedPool = /\b(raydium|orca|meteora|uniswap|pancakeswap|sushiswap|curve|balancer|aerodrome|liquidity pool|amm pool|dex pool|lp token|pair contract)\b/.test(tags)
        || /\b(raydium|orca|meteora|uniswap|pancakeswap|sushiswap|curve|balancer|aerodrome)(?:v\d+)?(?:pool|pair|lp)\b/.test(tags);
      const poolDex = poolAddresses.get(lowerAddress);
      const isDev = authorityAddresses.has(lowerAddress) || providerNamedDev;
      const isDexPool = !isDev && (Boolean(poolDex) || namedPool);
      const isCex = !isDev && !isDexPool && explicitExchange;
      let classification = 'STANDARD';
      let venue = 'HOLDER';
      let label = boundedText(holder.label || address, 44);
      let confidence = 'heuristic';

      if (holder.isScam) {
        classification = 'DEV_RISK';
        venue = 'RISK';
        label = `RISK · ${boundedText(holder.label || address, 28)}`;
        confidence = 'provider-flag';
      } else if (isDev) {
        classification = 'DEV_RISK';
        venue = 'DEV';
        label = `DEV / RISK · ${boundedText(holder.label || address, 24)}`;
        confidence = authorityAddresses.has(lowerAddress) ? 'on-chain-authority' : 'provider-label';
      } else if (isDexPool) {
        classification = 'DEX_POOL';
        venue = 'DEX';
        label = poolDex
          ? `${poolDex} DEX pool`
          : boundedText(holder.label || 'DEX liquidity pool', 44);
        confidence = poolDex ? 'dexscreener-pair' : 'provider-pool-label';
      } else if (isCex) {
        classification = 'CEX';
        venue = 'CEX';
        label = boundedText(holder.label || 'Exchange wallet', 44);
        confidence = 'provider-exchange-tag';
      } else if (holder.sharePct > 2 || /\b(smart money|whale|fund|market maker)\b/.test(tags)) {
        classification = 'WHALE';
        venue = 'WHALE';
        label = `WHALE · ${boundedText(holder.label || address, 32)}`;
        confidence = /\b(smart money|fund|market maker)\b/.test(tags) ? 'provider-tag' : 'supply-share';
      } else {
        classification = 'STANDARD';
        venue = 'HOLDER';
        label = `HOLDER · ${boundedText(holder.label || address, 32)}`;
        confidence = 'supply-share';
      }

      const isMintAuthority = String(security?.mintAuthority || '').toLowerCase() === lowerAddress;
      const isFreezeAuthority = String(security?.freezeAuthority || '').toLowerCase() === lowerAddress;
      const isContractOwner = String(security?.ownerAddress || '').toLowerCase() === lowerAddress;
      const isCreator = String(security?.creatorAddress || security?.deployerAddress || '').toLowerCase() === lowerAddress;
      const riskReasons = [];
      if (isMintAuthority && security?.isMintable === true) riskReasons.push('active mint authority');
      if (isFreezeAuthority) riskReasons.push('active freeze authority');
      if (isContractOwner && security?.ownershipRenounced === false) riskReasons.push('active contract owner');
      if (isCreator) riskReasons.push('token creator/deployer');
      if (providerNamedDev && !isCreator && !authorityAddresses.has(lowerAddress)) riskReasons.push('explorer developer label');
      if (holder.isScam) riskReasons.push('explorer risk flag');

      return {
        address,
        label,
        sharePct: holder.sharePct,
        venue,
        classification,
        confidence,
        isCex,
        isPool: isDexPool,
        isInsider: isDev || parseFlag(holder.isInsider) === true,
        isUnlocked: parseFlag(holder.isUnlocked ?? holder.unlocked) === true,
        risk: isDev || Boolean(holder.isScam) || parseFlag(holder.isUnlocked ?? holder.unlocked) === true,
        isMintable: isMintAuthority && security?.isMintable === true,
        isHoneypot: Boolean(isDev && security?.isHoneypot === true),
        riskReasons,
        tags: Array.isArray(holder.tags) ? holder.tags.slice(0, 8) : [],
      };
    });
  }

  function firstGoPlusRow(payload, address) {
    const result = payload?.result ?? payload?.data ?? null;
    if (!result) return null;
    if (Array.isArray(result)) return result[0] || null;
    if (typeof result === 'object') {
      const wanted = String(address || '').toLowerCase();
      const matchingKey = Object.keys(result).find((key) => key.toLowerCase() === wanted);
      if (matchingKey) return result[matchingKey];
      if (result[address]) return result[address];
      if (result.data && typeof result.data === 'object') return firstGoPlusRow({ result: result.data }, address);
      return Object.values(result).find((value) => value && typeof value === 'object') || null;
    }
    return null;
  }

  function firstAddress(value) {
    if (Array.isArray(value)) {
      for (const item of value) {
        const address = firstAddress(item);
        if (address) return address;
      }
      return null;
    }
    if (value && typeof value === 'object') {
      return firstAddress(value.address ?? value.authority ?? value.owner ?? value.admin ?? value.creator);
    }
    const address = String(value ?? '').trim();
    return address && address !== '[object Object]' ? address : null;
  }

  function normalizeGoPlusSecurity(row, chain, address) {
    if (!row) return null;
    const mintableObject = row.mintable && typeof row.mintable === 'object' ? row.mintable : null;
    const freezableObject = row.freezable && typeof row.freezable === 'object' ? row.freezable : null;
    const ownerValue = row.owner_address ?? row.ownerAddress ?? row.owner;
    const ownerRaw = firstAddress(ownerValue);
    const ownerReported = ownerRaw != null || (typeof ownerValue === 'string' && ownerValue.trim() === '');
    const mintAuthority = firstAddress(row.mint_authority ?? row.mintAuthority
      ?? mintableObject?.authority ?? mintableObject?.address);
    const creatorValue = firstAddress(row.creator_address ?? row.creatorAddress ?? row.creator ?? row.creators);
    const explicitRenounced = parseFlag(row.is_renounced ?? row.ownership_renounced ?? row.owner_renounced);
    const ownershipRenounced = explicitRenounced != null
      ? explicitRenounced
      : ownerReported ? isZeroAddress(ownerRaw ?? ownerValue) : null;
    const isMintable = parseFlag(row.is_mintable ?? row.isMintable ?? mintableObject?.status ?? row.mintable);
    const isHoneypot = parseFlag(row.is_honeypot ?? row.isHoneypot ?? row.honeypot);
    const freezeAuthority = firstAddress(row.freeze_authority ?? row.freezeAuthority
      ?? freezableObject?.authority ?? null);
    const known = [isMintable, ownershipRenounced, isHoneypot].some((value) => value != null)
      || Boolean(mintAuthority || freezeAuthority || creatorValue || ownerReported);
    if (!known) return null;
    return {
      status: 'available',
      provider: 'goplus',
      chain: chain.key,
      tokenAddress: address,
      checkedAt: Date.now(),
      isMintable,
      mintAuthority: mintAuthority ? String(mintAuthority) : null,
      mintAuthorityRevoked: mintAuthority ? false : null,
      ownershipRenounced,
      ownerAddress: ownerRaw != null && !isZeroAddress(ownerRaw) ? String(ownerRaw) : null,
      creatorAddress: creatorValue ? String(creatorValue) : null,
      deployerAddress: firstAddress(row.deployer_address),
      isHoneypot,
      freezeAuthority: freezeAuthority ? String(freezeAuthority) : null,
      isOpenSource: parseFlag(row.is_open_source ?? row.isOpenSource),
      canTakeBackOwnership: parseFlag(row.can_take_back_ownership ?? row.canTakeBackOwnership),
      cannotSellAll: parseFlag(row.cannot_sell_all ?? row.cannotSellAll),
      sellTax: row.sell_tax ?? row.sellTax ?? null,
      riskReasons: [
        ...(isMintable === true ? ['contract can mint'] : []),
        ...(ownershipRenounced === false ? ['contract owner is active'] : []),
        ...(isHoneypot === true ? ['honeypot reported'] : []),
        ...(parseFlag(row.cannot_sell_all) === true ? ['sell restriction reported'] : []),
        ...(parseFlag(row.transfer_pausable) === true ? ['transfers can be paused'] : []),
      ],
    };
  }

  async function fetchGoPlusSecurity(token, chain, address, signal) {
    const chainPart = chain.key === 'solana' ? 'solana/token_security' : `token_security/${chain.chainId}`;
    const url = `https://api.gopluslabs.io/api/v1/${chainPart}?contract_addresses=${encodeURIComponent(address)}`;
    const headers = { Accept: 'application/json' };
    if (fetchConfig.goplusAccessToken) headers.Authorization = `Bearer ${fetchConfig.goplusAccessToken}`;
    const payload = await requestJson(url, { headers }, signal);
    const row = firstGoPlusRow(payload, address);
    if (!row) throw new Error('GoPlus returned no token security record');
    return normalizeGoPlusSecurity(row, chain, address);
  }

  async function fetchHoneypotSecurity(chain, address, signal) {
    if (chain.key === 'solana') return null;
    const url = new URL('https://api.honeypot.is/v2/IsHoneypot');
    url.searchParams.set('address', address);
    url.searchParams.set('chainID', String(chain.chainId));
    const payload = await requestJson(url.toString(), { headers: { Accept: 'application/json' } }, signal);
    const honeypotResult = payload?.honeypotResult || payload?.simulationResult?.honeypotResult || {};
    const isHoneypot = parseFlag(honeypotResult.isHoneypot ?? payload?.isHoneypot);
    if (isHoneypot == null) return null;
    return {
      status: 'partial',
      provider: 'honeypot.is',
      chain: chain.key,
      tokenAddress: address,
      checkedAt: Date.now(),
      isMintable: null,
      mintAuthority: null,
      mintAuthorityRevoked: null,
      ownershipRenounced: null,
      ownerAddress: null,
      creatorAddress: null,
      isHoneypot,
      freezeAuthority: null,
      riskReasons: isHoneypot ? ['honeypot simulation reported risk'] : [],
    };
  }

  async function fetchEvmOwner(chain, address, signal) {
    const urls = uniqueUrls(chain.rpcs, fetchConfig.evmRpcUrls?.[chain.key]);
    const selectors = ['0x8da5cb5b', '0x893d20e8']; // owner() / getOwner()
    const attempts = urls.flatMap((url) => selectors.map(async (selector) => {
      try {
        const result = await rpcJson(url, 'eth_call', [{ to: address, data: selector }, 'latest'], signal);
        return typeof result === 'string' && /^0x[0-9a-f]{64}$/i.test(result)
          ? `0x${result.slice(-40)}`
          : null;
      } catch {
        return null;
      }
    }));
    const results = await Promise.all(attempts);
    if (signal?.aborted) throw abortError();
    return results.find(Boolean) || null;
  }

  async function fetchSecuritySnapshot(token, chain, address, holderResultPromise, signal) {
    let goplus = null;
    let goPlusError = null;
    try { goplus = await fetchGoPlusSecurity(token, chain, address, signal); }
    catch (error) {
      if (signal?.aborted) throw abortError();
      goPlusError = error;
    }
    if (signal?.aborted) throw abortError();

    let fallback = null;
    const holderResult = chain.key === 'solana' ? await holderResultPromise : null;
    if (chain.key === 'solana' && holderResult?.mintInfo) {
      const mintInfo = holderResult.mintInfo;
      fallback = {
        status: 'partial',
        provider: 'solana-rpc',
        chain: chain.key,
        tokenAddress: address,
        checkedAt: Date.now(),
        isMintable: Boolean(mintInfo.mintAuthority),
        mintAuthority: mintInfo.mintAuthority,
        mintAuthorityRevoked: !mintInfo.mintAuthority,
        ownershipRenounced: null,
        ownerAddress: null,
        creatorAddress: null,
        isHoneypot: null,
        freezeAuthority: mintInfo.freezeAuthority,
        riskReasons: [
          ...(mintInfo.mintAuthority ? ['mint authority remains active'] : []),
          ...(mintInfo.freezeAuthority ? ['freeze authority remains active'] : []),
        ],
      };
    }

    if (chain.key !== 'solana') {
      const needHoneypot = !goplus || goplus.isHoneypot == null;
      const needOwner = !goplus || goplus.ownershipRenounced == null;
      const [honeypotResult, ownerResult] = await Promise.all([
        needHoneypot ? fetchHoneypotSecurity(chain, address, signal).catch(() => null) : null,
        needOwner ? fetchEvmOwner(chain, address, signal).catch(() => null) : null,
      ]);
      if (signal?.aborted) throw abortError();

      if (honeypotResult) fallback = { ...(fallback || {}), ...honeypotResult };
      if (ownerResult) {
        fallback = {
          ...(fallback || {}),
          provider: fallback?.provider ? `${fallback.provider}+public-rpc` : 'public-rpc',
          ownerAddress: isZeroAddress(ownerResult) ? null : ownerResult,
          ownershipRenounced: isZeroAddress(ownerResult),
          status: 'partial',
          chain: chain.key,
          tokenAddress: address,
          checkedAt: Date.now(),
        };
      }
    }

    if (goplus && fallback) {
      const merged = { ...fallback, ...goplus };
      for (const key of ['isMintable', 'mintAuthority', 'mintAuthorityRevoked', 'ownershipRenounced', 'ownerAddress', 'creatorAddress', 'isHoneypot', 'freezeAuthority']) {
        if (goplus[key] == null && fallback[key] != null) merged[key] = fallback[key];
      }
      merged.provider = [...new Set(`${fallback.provider || ''}+${goplus.provider || ''}`.split('+').filter(Boolean))].join('+');
      merged.status = 'available';
      merged.riskReasons = [...new Set([...(fallback.riskReasons || []), ...(goplus.riskReasons || [])])];
      return merged;
    }
    if (goplus) return goplus;
    if (fallback) return fallback;
    return {
      status: 'unavailable',
      provider: 'none',
      chain: chain.key,
      tokenAddress: address,
      checkedAt: Date.now(),
      isMintable: null,
      mintAuthority: null,
      mintAuthorityRevoked: null,
      ownershipRenounced: null,
      ownerAddress: null,
      creatorAddress: null,
      isHoneypot: null,
      freezeAuthority: null,
      riskReasons: [],
      note: goPlusError ? 'GoPlus was unavailable; no reliable security result was returned.' : 'No supported security source returned a result.',
    };
  }

  function polygonArea(points) {
    let twiceArea = 0;
    for (let i = 0, n = points.length; i < n; i += 1) {
      const a = points[i];
      const b = points[(i + 1) % n];
      twiceArea += a.x * b.y - b.x * a.y;
    }
    return Math.abs(twiceArea) * 0.5;
  }

  function polygonCentroid(points) {
    let areaTimesSix = 0;
    let x = 0;
    let y = 0;
    for (let i = 0, n = points.length; i < n; i += 1) {
      const a = points[i];
      const b = points[(i + 1) % n];
      const cross = a.x * b.y - b.x * a.y;
      areaTimesSix += cross;
      x += (a.x + b.x) * cross;
      y += (a.y + b.y) * cross;
    }
    if (Math.abs(areaTimesSix) < 1e-6) {
      return points.reduce((center, point) => ({ x: center.x + point.x / points.length, y: center.y + point.y / points.length }), { x: 0, y: 0 });
    }
    return { x: x / (3 * areaTimesSix), y: y / (3 * areaTimesSix) };
  }

  function clipHalfPlane(polygon, nx, ny, limit) {
    if (polygon.length === 0) return polygon;
    const output = [];
    const epsilon = 1e-7;
    for (let i = 0; i < polygon.length; i += 1) {
      const start = polygon[i];
      const end = polygon[(i + 1) % polygon.length];
      const startValue = nx * start.x + ny * start.y - limit;
      const endValue = nx * end.x + ny * end.y - limit;
      const startInside = startValue <= epsilon;
      const endInside = endValue <= epsilon;

      if (startInside && endInside) {
        output.push(end);
      } else if (startInside && !endInside) {
        const denominator = startValue - endValue;
        const t = Math.abs(denominator) < epsilon ? 0 : startValue / denominator;
        output.push({ x: start.x + (end.x - start.x) * t, y: start.y + (end.y - start.y) * t });
      } else if (!startInside && endInside) {
        const denominator = startValue - endValue;
        const t = Math.abs(denominator) < epsilon ? 0 : startValue / denominator;
        output.push({ x: start.x + (end.x - start.x) * t, y: start.y + (end.y - start.y) * t });
        output.push(end);
      }
    }
    return output;
  }

  /** Power/Laguerre cells: site weights are balanced to match each supply share. */
  function calculatePowerCells(sites, width, height) {
    const cells = [];
    for (let i = 0; i < sites.length; i += 1) {
      const site = sites[i];
      let points = [
        { x: 0, y: 0 },
        { x: width, y: 0 },
        { x: width, y: height },
        { x: 0, y: height },
      ];

      for (let j = 0; j < sites.length && points.length >= 3; j += 1) {
        if (i === j) continue;
        const other = sites[j];
        let dx = other.x - site.x;
        let dy = other.y - site.y;
        if (Math.abs(dx) + Math.abs(dy) < 1e-6) {
          const angle = ((hashString(site.id + other.id) % 10000) / 10000) * TAU;
          dx = Math.cos(angle) * 0.001;
          dy = Math.sin(angle) * 0.001;
        }
        const nx = 2 * dx;
        const ny = 2 * dy;
        const limit = other.x * other.x + other.y * other.y
          - site.x * site.x - site.y * site.y + site.weight - other.weight;
        points = clipHalfPlane(points, nx, ny, limit);
      }

      const area = points.length >= 3 ? polygonArea(points) : 0;
      cells.push({ site, points, area, center: points.length >= 3 ? polygonCentroid(points) : { x: site.x, y: site.y } });
    }
    return cells;
  }

  function pointInPolygon(point, polygon) {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
      const a = polygon[i];
      const b = polygon[j];
      const crosses = (a.y > point.y) !== (b.y > point.y)
        && point.x < ((b.x - a.x) * (point.y - a.y)) / ((b.y - a.y) || 1e-9) + a.x;
      if (crosses) inside = !inside;
    }
    return inside;
  }

  function convexHull(points) {
    const unique = [...new Map(points.map((point) => [`${Math.round(point.x * 10)}:${Math.round(point.y * 10)}`, point])).values()]
      .sort((a, b) => a.x - b.x || a.y - b.y);
    if (unique.length <= 3) return unique;
    const cross = (origin, a, b) => (a.x - origin.x) * (b.y - origin.y) - (a.y - origin.y) * (b.x - origin.x);
    const lower = [];
    for (const point of unique) {
      while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) lower.pop();
      lower.push(point);
    }
    const upper = [];
    for (let index = unique.length - 1; index >= 0; index -= 1) {
      const point = unique[index];
      while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) upper.pop();
      upper.push(point);
    }
    lower.pop();
    upper.pop();
    return lower.concat(upper);
  }

  function isMobileTouchViewport() {
    const userAgent = typeof navigator !== 'undefined' ? String(navigator.userAgent || '') : '';
    const touchPoints = typeof navigator !== 'undefined' ? Number(navigator.maxTouchPoints || 0) : 0;
    let coarsePointer = false;
    try { coarsePointer = Boolean(window.matchMedia?.('(pointer: coarse)')?.matches); } catch { /* matchMedia can be unavailable in embedded browsers */ }
    const mobileUserAgent = /android|iphone|ipad|ipod|mobile/i.test(userAgent);
    const width = Number(window.innerWidth || document.documentElement?.clientWidth || 0);
    return mobileUserAgent || ((touchPoints > 0 || coarsePointer) && width <= 1280);
  }

  // Rendering-only decimation keeps hit testing and power-cell areas exact.
  // Convex cells are sampled evenly so phone GPUs trace fewer edges/facets.
  function simplifyPolygonPoints(points, maxVertices) {
    if (!Array.isArray(points) || points.length < 3 || maxVertices < 3 || points.length <= maxVertices) return points;
    const simplified = [];
    const step = points.length / maxVertices;
    for (let index = 0; index < maxVertices; index += 1) {
      simplified.push(points[Math.floor(index * step)]);
    }
    return simplified;
  }

  function boundsOf(points) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const point of points) {
      minX = Math.min(minX, point.x);
      minY = Math.min(minY, point.y);
      maxX = Math.max(maxX, point.x);
      maxY = Math.max(maxY, point.y);
    }
    return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
  }

  function tracePolygon(ctx, points) {
    if (!points || points.length < 3) return;
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i += 1) ctx.lineTo(points[i].x, points[i].y);
    ctx.closePath();
  }

  function makeDemoData() {
    return { holders: DEMO_HOLDERS, totalSupplyPct: 100, source: 'demo' };
  }

  function updateFetchStatus(next) {
    fetchStatus = { ...fetchStatus, ...next, updatedAt: Date.now() };
    window.dispatchEvent(new CustomEvent('nodecluster:data-status', { detail: { ...fetchStatus } }));
    return { ...fetchStatus };
  }

  function applyFetchedData(data, key) {
    pendingData = data;
    lastDataTokenKey = key;
    if (engine) {
      const dataTokenMatches = data?.token && activeToken
        && dataKeyForToken(data.token) === dataKeyForToken(activeToken);
      if (dataTokenMatches) engine.setToken(activeToken);
      else if (data?.token) engine.setToken(data.token);
      engine.setData(data);
    }
    if (data?.security) {
      window.dispatchEvent(new CustomEvent('nodecluster:security-update', { detail: data.security }));
    }
    const eventToken = activeToken && data?.token
      && dataKeyForToken(data.token) === dataKeyForToken(activeToken)
      ? activeToken
      : data?.token || activeToken || null;
    window.dispatchEvent(new CustomEvent('nodecluster:data-ready', {
      detail: { token: eventToken, source: data?.source || 'unknown', holders: data?.holders?.length || 0 },
    }));
  }

  function configureFetcher(options = {}) {
    const wasEnabled = fetchConfig.autoFetch !== false;
    const dataSourcesChanged = ['maxHolders', 'goplusAccessToken', 'solanaRpcUrls', 'evmRpcUrls', 'blockscoutHosts', 'binanceFuturesBaseUrl', 'liquidationPollMs']
      .some((key) => Object.prototype.hasOwnProperty.call(options, key));
    fetchConfig = {
      ...fetchConfig,
      ...options,
      solanaRpcUrls: uniqueUrls(fetchConfig.solanaRpcUrls, options.solanaRpcUrls),
      evmRpcUrls: { ...fetchConfig.evmRpcUrls, ...(options.evmRpcUrls || {}) },
      blockscoutHosts: { ...fetchConfig.blockscoutHosts, ...(options.blockscoutHosts || {}) },
    };
    if (dataSourcesChanged) {
      if (activeFetch) activeFetch.controller.abort();
      activeFetch = null;
      fetchSequence += 1;
      fetchCache.clear();
      stopLiquidationPolling();
    }
    if (fetchConfig.autoFetch === false) {
      if (activeFetch) activeFetch.controller.abort();
      activeFetch = null;
      fetchSequence += 1;
      updateFetchStatus({ status: 'disabled', note: 'Automatic public data fetching is disabled.' });
    } else if ((!wasEnabled || dataSourcesChanged) && activeToken && engine) {
      void fetchTokenData(activeToken, { force: dataSourcesChanged });
    }
    syncLiquidationPolling();
    return {
      autoFetch: fetchConfig.autoFetch !== false,
      maxHolders: clamp(Math.trunc(finite(fetchConfig.maxHolders, MAX_FETCH_HOLDERS)), 1, MAX_FETCH_HOLDERS),
      hasGoPlusAccessToken: Boolean(fetchConfig.goplusAccessToken),
      customSolanaRpcs: fetchConfig.solanaRpcUrls.length,
      liquidationPollMs: clamp(Math.trunc(finite(fetchConfig.liquidationPollMs, BINANCE_LIQUIDATION_POLL_MS)), 15_000, 120_000),
    };
  }

  function dataKeyForToken(token) {
    const chain = resolveChain(token);
    const address = tokenAddress(token);
    return chain && address ? `${chain.key}:${address.toLowerCase()}` : `unsupported:${String(token?.id || token?.symbol || 'unknown')}`;
  }

  async function fetchTokenData(token = activeToken, options = {}) {
    if (!token) {
      if (activeFetch) activeFetch.controller.abort();
      activeFetch = null;
      fetchSequence += 1;
      updateFetchStatus({ status: 'unsupported', source: null, chain: null, tokenId: null, note: 'No active token.' });
      return null;
    }
    if (activeToken !== token) setActiveToken(token);
    const chain = resolveChain(token);
    const address = tokenAddress(token);
    const tokenId = String(token.id || token.symbol || address || 'unknown');
    const key = dataKeyForToken(token);

    if (!chain || !address || !isValidAddress(address, chain.key)) {
      if (activeFetch) {
        activeFetch.controller.abort();
        activeFetch = null;
        fetchSequence += 1;
      }
      if (lastDataTokenKey && lastDataTokenKey !== key) applyFetchedData(makeDemoData(), key);
      updateFetchStatus({
        status: 'unsupported', source: null, chain: chain?.key || null, tokenId,
        note: 'Holder scans need a supported DEX token contract or Solana mint; CEX symbols do not have a token contract.',
      });
      return null;
    }

    if (activeFetch && activeFetch.key !== key) {
      activeFetch.controller.abort();
      activeFetch = null;
      fetchSequence += 1;
    }
    if (activeFetch?.key === key && !options.force) return activeFetch.promise;
    if (!options.force) {
      const cached = fetchCache.get(key);
      if (cached && Date.now() - cached.at < Math.max(0, finite(fetchConfig.cacheMs, FETCH_CACHE_MS))) {
        applyFetchedData(cached.data, key);
        updateFetchStatus({
          status: cached.data.dataStatus?.partial || !cached.data.dataStatus?.securityAvailable ? 'partial' : 'success',
          source: cached.data.source, chain: chain.key, tokenId,
          holderCount: cached.data.holders.length, note: 'Fresh in-memory snapshot reused.',
        });
        return cached.data;
      }
    }

    if (activeFetch) activeFetch.controller.abort();
    const controller = new AbortController();
    const sequence = ++fetchSequence;
    if (lastDataTokenKey && lastDataTokenKey !== key) applyFetchedData(makeDemoData(), key);
    updateFetchStatus({ status: 'loading', source: null, chain: chain.key, tokenId, note: 'Querying public holder and security endpoints.' });

    const promise = (async () => {
      try {
        const dexPromise = fetchDexScreenerPairs(chain, address, controller.signal)
          .catch(() => ({ pairs: [], poolAddresses: new Map(), provider: null }));
        const holderPromise = chain.key === 'solana'
          ? fetchSolanaHolders(address, chain, controller.signal)
          : fetchBlockscoutHolders(address, chain, controller.signal);
        const securityPromise = fetchSecuritySnapshot(token, chain, address, holderPromise, controller.signal).catch(() => ({
          status: 'unavailable', provider: 'none', chain: chain.key, tokenAddress: address,
          checkedAt: Date.now(), isMintable: null, mintAuthority: null, mintAuthorityRevoked: null,
          ownershipRenounced: null, ownerAddress: null, creatorAddress: null, isHoneypot: null,
          freezeAuthority: null, riskReasons: [], note: 'Security endpoints are unavailable.',
        }));
        const [holderResult, dexResult, security] = await Promise.all([holderPromise, dexPromise, securityPromise]);
        if (sequence !== fetchSequence || controller.signal.aborted) return null;

        if (chain.key === 'solana' && holderResult.mintInfo) {
          const mintInfo = holderResult.mintInfo;
          if (security.isMintable == null) security.isMintable = Boolean(mintInfo.mintAuthority);
          security.mintAuthority = mintInfo.mintAuthority;
          security.mintAuthorityRevoked = !mintInfo.mintAuthority;
          security.freezeAuthority = mintInfo.freezeAuthority;
          if (mintInfo.mintAuthority && !security.riskReasons.includes('mint authority remains active')) {
            security.riskReasons.push('mint authority remains active');
          }
          if (mintInfo.freezeAuthority && !security.riskReasons.includes('freeze authority remains active')) {
            security.riskReasons.push('freeze authority remains active');
          }
        }

        const classified = classifyWallets(holderResult.holders, security, dexResult);
        if (classified.length === 0) throw new Error('Holder endpoints returned no usable wallet rows');
        const updatedAt = Date.now();
        const dataStatus = {
          partial: Boolean(holderResult.partial),
          provider: holderResult.provider,
          endpoint: holderResult.endpoint || null,
          holderLimit: holderResult.holderLimit || classified.length,
          note: holderResult.note || null,
          securityProvider: security.provider || 'none',
          securityAvailable: security.status !== 'unavailable',
          dexPairs: dexResult.pairs.length,
          updatedAt,
        };
        const data = {
          holders: classified,
          totalSupplyPct: 100,
          source: holderResult.provider,
          security,
          dataStatus,
          token,
        };
        fetchCache.set(key, { data, at: updatedAt });
        if (fetchCache.size > 16) fetchCache.delete(fetchCache.keys().next().value);
        applyFetchedData(data, key);
        updateFetchStatus({
          status: dataStatus.partial || !dataStatus.securityAvailable ? 'partial' : 'success',
          source: holderResult.provider, chain: chain.key, tokenId,
          holderCount: classified.length, securityProvider: security.provider || 'none',
          note: dataStatus.note || (dataStatus.securityAvailable ? null : 'Holder snapshot loaded; security scan unavailable.'),
        });
        return data;
      } catch (error) {
        if (sequence !== fetchSequence || controller.signal.aborted || error?.name === 'AbortError') return null;
        controller.abort();
        updateFetchStatus({
          status: 'error', source: null, chain: chain.key, tokenId,
          note: 'Free public holder providers were unavailable or rate-limited. The current demo/host snapshot was kept.',
        });
        console.warn('[NodeCluster] Public token data fetch failed:', error?.message || error);
        return null;
      } finally {
        if (activeFetch?.sequence === sequence) activeFetch = null;
      }
    })();
    activeFetch = { key, controller, promise, sequence };
    return promise;
  }

  function isInsiderSite(site) {
    const classification = String(site?.classification || '').toUpperCase();
    return Boolean(site?.isInsider || site?.isUnlocked || ['DEV_RISK', 'INSIDER', 'UNLOCKED'].includes(classification));
  }

  function transactionTimestamp(value) {
    if (typeof value === 'string' && !/^\d+(?:\.\d+)?$/.test(value.trim())) {
      const parsed = Date.parse(value);
      if (Number.isFinite(parsed)) return parsed;
    }
    let timestamp = finite(value, Date.now());
    if (timestamp > 0 && timestamp < 1e12) timestamp *= 1000;
    return timestamp > 0 ? timestamp : Date.now();
  }

  function flowSpeedPxPerSecond(ageMs) {
    const age = Math.max(0, ageMs);
    if (age <= 24 * 60 * 60 * 1000) return 145 - (age / (24 * 60 * 60 * 1000)) * 87;
    return Math.max(22, 58 * Math.exp(-(age - 24 * 60 * 60 * 1000) / (72 * 60 * 60 * 1000)));
  }

  function isCredibleMevSignal(signal, token = activeToken) {
    if (!signal || typeof signal !== 'object' || signal.active === false || signal.clear === true || !token) return false;
    if (!resolveChain(token) || !tokenAddress(token)) return false;
    const source = String(signal.source || signal.provider || '').trim();
    const activity = String(signal.type || signal.kind || signal.category || '').toLowerCase();
    const isSandwichOrFrontrun = /sandwich|front[\s_-]?run|frontrun/.test(activity);
    const pairAddress = String(signal.pairAddress || signal.dexPairAddress || signal.poolAddress
      || signal.pair?.address || (typeof signal.pair === 'string' ? signal.pair : '')).trim();
    const txHash = String(signal.pendingTxHash || signal.txHash || signal.transactionHash || signal.hash || '').trim();
    const pending = signal.pending === true || signal.unconfirmed === true || signal.confirmed === false
      || ['pending', 'unconfirmed', 'mempool'].includes(String(signal.status || '').toLowerCase());
    const confidence = Number(signal.confidence);
    const credible = signal.credible === true || (Number.isFinite(confidence) && confidence >= 0.85);
    const signalTokenAddress = String(signal.tokenAddress || signal.contractAddress || signal.token?.address || '').toLowerCase();
    const signalTokenId = String(signal.tokenId || signal.token?.id || '');
    const tokenMatches = signalTokenAddress
      ? signalTokenAddress === tokenAddress(token).toLowerCase()
      : Boolean(signalTokenId && signalTokenId === String(token.id || ''));
    return Boolean(source && isSandwichOrFrontrun && pairAddress && txHash && pending && credible && tokenMatches);
  }

  function binanceSymbolForToken(token) {
    const rawSymbol = String(token?.base || token?.symbol?.split(/[\/:]/)?.[0] || '').trim().toUpperCase();
    const base = rawSymbol.replace(/[^A-Z0-9]/g, '');
    if (!/^[A-Z0-9]{2,20}$/.test(base)) return null;
    return base.endsWith('USDT') ? base : `${base}USDT`;
  }

  function buildLiquidationHeatmap(openInterestPayload, depthPayload, premiumPayload, symbol) {
    const bestBid = finite(depthPayload?.bids?.[0]?.[0], 0);
    const bestAsk = finite(depthPayload?.asks?.[0]?.[0], 0);
    const markPrice = finite(premiumPayload?.markPrice, NaN)
      || (bestBid > 0 && bestAsk > 0 ? (bestBid + bestAsk) / 2 : NaN);
    const contracts = finite(openInterestPayload?.openInterest, NaN);
    if (!(markPrice > 0) || !(contracts > 0)) throw new Error('Binance did not return valid mark price and open interest');

    const bids = (Array.isArray(depthPayload?.bids) ? depthPayload.bids : [])
      .map(([price, quantity]) => ({ price: finite(price, 0), quantity: finite(quantity, 0) }))
      .filter((level) => level.price > 0 && level.quantity > 0);
    const asks = (Array.isArray(depthPayload?.asks) ? depthPayload.asks : [])
      .map(([price, quantity]) => ({ price: finite(price, 0), quantity: finite(quantity, 0) }))
      .filter((level) => level.price > 0 && level.quantity > 0);
    if (bids.length === 0 || asks.length === 0) throw new Error('Binance order book has no usable bid/ask levels');

    const rawLevels = [];
    const leverageWeights = [0.4, 0.3, 0.2, 0.1];
    for (const side of ['long', 'short']) {
      const bookSide = side === 'long' ? bids : asks;
      const totalBookUsd = bookSide.reduce((sum, level) => sum + level.price * level.quantity, 0);
      const sideLevels = LIQUIDATION_LEVERAGES.map((leverage, index) => {
        const estimatedPrice = side === 'long'
          ? markPrice * (1 - 1 / leverage + 0.004)
          : markPrice * (1 + 1 / leverage - 0.004);
        const tolerance = Math.max(markPrice * 0.0015, estimatedPrice * 0.0015);
        const localDepthUsd = bookSide.reduce((sum, level) => (
          Math.abs(level.price - estimatedPrice) <= tolerance
            ? sum + level.price * level.quantity
            : sum
        ), 0);
        const depthRatio = totalBookUsd > 0 ? clamp(localDepthUsd / totalBookUsd * 8, 0, 1) : 0;
        const leverageWeight = leverageWeights[index] || 0.1;
        return {
          side,
          leverage,
          price: estimatedPrice,
          distancePct: Math.abs((estimatedPrice - markPrice) / markPrice) * 100,
          depthUsd: localDepthUsd,
          modeledNotionalUsd: contracts * markPrice * 0.5 * leverageWeight,
          rawIntensity: leverageWeight * 0.7 + depthRatio * 0.3,
        };
      });
      const maxIntensity = Math.max(...sideLevels.map((level) => level.rawIntensity), 0.001);
      for (const level of sideLevels) {
        rawLevels.push({ ...level, intensity: clamp(level.rawIntensity / maxIntensity, 0, 1) });
        delete level.rawIntensity;
      }
    }

    return {
      status: 'available',
      source: 'binance-usdm-open-interest+depth',
      symbol,
      markPrice,
      openInterestContracts: contracts,
      openInterestUsd: contracts * markPrice,
      updatedAt: Date.now(),
      estimated: true,
      assumptions: 'Directional exposure split 50/50; entry/leverage distribution modeled. Binance publishes aggregate OI and book depth, not liquidation-price pools.',
      levels: rawLevels,
    };
  }

  async function fetchLiquidationHeatmap(token, controller, sequence) {
    const symbol = binanceSymbolForToken(token);
    if (!symbol) {
      const unsupported = { status: 'unsupported', source: 'binance-usdm', symbol: null, levels: [], note: 'No compatible USDT-margined Futures symbol could be derived.' };
      if (sequence === liquidationSequence) {
        engine?.setLiquidationHeatmap(unsupported);
        window.dispatchEvent(new CustomEvent('nodecluster:liquidation-update', { detail: unsupported }));
      }
      if (liquidationController === controller) liquidationController = null;
      return unsupported;
    }

    const baseUrl = String(fetchConfig.binanceFuturesBaseUrl || 'https://fapi.binance.com').replace(/\/+$/, '');
    const query = `symbol=${encodeURIComponent(symbol)}`;
    try {
      const [openInterest, depth, premium] = await Promise.all([
        requestJson(`${baseUrl}/fapi/v1/openInterest?${query}`, { headers: { Accept: 'application/json' } }, controller.signal),
        requestJson(`${baseUrl}/fapi/v1/depth?${query}&limit=100`, { headers: { Accept: 'application/json' } }, controller.signal),
        requestJson(`${baseUrl}/fapi/v1/premiumIndex?${query}`, { headers: { Accept: 'application/json' } }, controller.signal),
      ]);
      if (sequence !== liquidationSequence || controller.signal.aborted) return null;
      const snapshot = buildLiquidationHeatmap(openInterest, depth, premium, symbol);
      engine?.setLiquidationHeatmap(snapshot);
      window.dispatchEvent(new CustomEvent('nodecluster:liquidation-update', { detail: snapshot }));
      return snapshot;
    } catch (error) {
      if (sequence !== liquidationSequence || controller.signal.aborted || error?.name === 'AbortError') return null;
      const unavailable = {
        status: 'unavailable', source: 'binance-usdm', symbol, levels: [], updatedAt: Date.now(),
        note: 'Open interest/depth is unavailable for this symbol or Binance Futures is rate-limited.',
      };
      engine?.setLiquidationHeatmap(unavailable);
      window.dispatchEvent(new CustomEvent('nodecluster:liquidation-update', { detail: unavailable }));
      return unavailable;
    } finally {
      if (liquidationController === controller) liquidationController = null;
    }
  }

  let liquidationPollingKey = null;

  function stopLiquidationPolling() {
    if (liquidationTimer) window.clearInterval(liquidationTimer);
    liquidationTimer = null;
    if (liquidationController) liquidationController.abort();
    liquidationController = null;
    liquidationPollingKey = null;
    liquidationSequence += 1;
  }

  function requestLiquidationSnapshot(token = activeToken) {
    if (!engine || !token || fetchConfig.autoFetch === false) return Promise.resolve(null);
    if (liquidationController) liquidationController.abort();
    const controller = new AbortController();
    const sequence = ++liquidationSequence;
    liquidationController = controller;
    engine.setLiquidationHeatmap({
      status: 'loading', source: 'binance-usdm', symbol: binanceSymbolForToken(token), levels: [],
    });
    return fetchLiquidationHeatmap(token, controller, sequence);
  }

  function syncLiquidationPolling() {
    const shouldPoll = Boolean(engine && activeToken && activeLayers.liquidationHeatmap && fetchConfig.autoFetch !== false);
    const nextKey = shouldPoll ? dataKeyForToken(activeToken) : null;
    if (shouldPoll && !binanceSymbolForToken(activeToken)) {
      stopLiquidationPolling();
      const unsupported = { status: 'unsupported', source: 'binance-usdm', symbol: null, levels: [], note: 'No compatible USDT-margined Futures symbol could be derived.' };
      engine.setLiquidationHeatmap(unsupported);
      window.dispatchEvent(new CustomEvent('nodecluster:liquidation-update', { detail: unsupported }));
      return;
    }
    if (shouldPoll && liquidationTimer && liquidationPollingKey === nextKey) return;
    if (!shouldPoll && !liquidationTimer && !liquidationController) {
      if (engine) engine.setLiquidationHeatmap({
        status: 'disabled', source: null, symbol: null, levels: [],
        note: activeLayers.liquidationHeatmap && fetchConfig.autoFetch === false
          ? 'Automatic public data fetching is disabled.' : 'Enable the liquidation heatmap layer to load Futures data.',
      });
      return;
    }

    stopLiquidationPolling();
    if (!shouldPoll) {
      if (engine) engine.setLiquidationHeatmap({
        status: 'disabled', source: null, symbol: null, levels: [],
        note: activeLayers.liquidationHeatmap && fetchConfig.autoFetch === false
          ? 'Automatic public data fetching is disabled.' : 'Enable the liquidation heatmap layer to load Futures data.',
      });
      return;
    }

    liquidationPollingKey = nextKey;
    void requestLiquidationSnapshot(activeToken);
    const interval = clamp(Math.trunc(finite(fetchConfig.liquidationPollMs, BINANCE_LIQUIDATION_POLL_MS)), 15_000, 120_000);
    liquidationTimer = window.setInterval(() => void requestLiquidationSnapshot(activeToken), interval);
  }

  class CrystalEngine {
    constructor(canvas, options = {}) {
      this.canvas = canvas;
      this.ctx = canvas?.getContext?.('2d', { alpha: true, desynchronized: true }) || null;
      if (!this.ctx) throw new Error('NodeCluster needs a 2D canvas context.');

      this.layers = { ...DEFAULT_LAYERS, ...(options.layers || {}) };
      this.token = options.token || null;
      this.width = 1;
      this.height = 1;
      this.dpr = 1;
      this.exportDpr = Number.isFinite(Number(options.dpr)) ? clamp(Number(options.dpr), 1, 3) : null;
      this.staticRender = Boolean(options.staticRender);
      this.mobileOptimized = !this.staticRender && isMobileTouchViewport();
      this.minimumQualityTier = this.mobileOptimized ? 1 : 0;
      this.qualityTierIndex = this.minimumQualityTier;
      this.quality = PERFORMANCE_QUALITY[this.qualityTierIndex];
      this.frameCostEwma = null;
      this.frameIntervalEwma = null;
      this.lastDrawTimestamp = Number.NEGATIVE_INFINITY;
      this.targetFps = TARGET_FPS;
      this.below45StartedAt = null;
      this.below45DurationMs = 0;
      this.mobilePerformanceFloorApplied = false;
      this.slowFrameCount = 0;
      this.fastFrameCount = 0;
      this.renderedFrames = 0;
      this.nextRenderAt = Number.NEGATIVE_INFINITY;
      this.watermarkEnabled = options.watermark !== false;
      this.watermarkGrid = Boolean(options.watermarkGrid);
      this.brandText = boundedText(options.brandText || '', 40);
      this.sites = [];
      this.cells = [];
      this.particles = [];
      this.hovered = null;
      this.drag = null;
      this.activePointers = new Map();
      this.pinch = null;
      this.viewScale = 1;
      this.viewOffsetX = 0;
      this.viewOffsetY = 0;
      this.rafId = 0;
      this.running = false;
      this.destroyed = false;
      this.firstFrame = true;
      this.frame = 0;
      this.lastFrameAt = now();
      this.source = 'demo';
      this.security = options.data?.security || null;
      this.dataStatus = options.data?.dataStatus || null;
      this.liquidationHeatmap = { status: 'disabled', source: null, symbol: null, levels: [] };
      this.mevAlert = null;
      this.flowEdges = new Map();
      this.insiderSharePct = 0;
      this.totalSupplyPct = 100;
      this.nextDemoPulseAt = now() + 1100;
      this.demoRandom = seededRandom(hashString(this.token?.id || this.token?.symbol || 'nodecluster-demo'));
      this.savedTouchAction = canvas.style.touchAction;

      this.boundPointerDown = (event) => this.onPointerDown(event);
      this.boundPointerMove = (event) => this.onPointerMove(event);
      this.boundPointerUp = (event) => this.onPointerUp(event);
      this.boundPointerCancel = (event) => this.onPointerCancel(event);
      this.boundWheel = (event) => this.onWheel(event);
      this.boundVisibility = () => this.onVisibilityChange();
      this.boundResize = () => this.resize();
      this.resizeObserver = null;

      if (!this.staticRender) {
        // Pointer Events map touchstart/move/end to pointer types on iOS Safari
        // and Android Chrome; separate Touch listeners would double-handle pinch input.
        this.canvas.style.touchAction = 'none';
        this.canvas.addEventListener('pointerdown', this.boundPointerDown, { passive: false });
        this.canvas.addEventListener('pointermove', this.boundPointerMove, { passive: false });
        this.canvas.addEventListener('pointerup', this.boundPointerUp);
        this.canvas.addEventListener('pointercancel', this.boundPointerCancel);
        this.canvas.addEventListener('lostpointercapture', this.boundPointerCancel);
        this.canvas.addEventListener('wheel', this.boundWheel, { passive: false });
        window.addEventListener('resize', this.boundResize);
        document.addEventListener('visibilitychange', this.boundVisibility);

        if (typeof ResizeObserver !== 'undefined') {
          this.resizeObserver = new ResizeObserver(() => this.resize());
          this.resizeObserver.observe(this.canvas.parentElement || this.canvas);
        }
      }

      this.resize();
      this.setData(options.data || makeDemoData(), { preservePositions: false });
      this.canvas.dataset.nodeclusterEngine = 'voronoi-crystal';
    }

    setToken(token) {
      const previousKey = this.token ? dataKeyForToken(this.token) : null;
      this.token = token || null;
      const nextKey = this.token ? dataKeyForToken(this.token) : null;
      if (previousKey && nextKey && previousKey !== nextKey) {
        this.flowEdges.clear();
        this.particles = [];
        this.drag = null;
        this.activePointers.clear();
        this.pinch = null;
        this.viewScale = 1;
        this.viewOffsetX = 0;
        this.viewOffsetY = 0;
        this.mevAlert = null;
        this.liquidationHeatmap = { status: 'loading', source: 'binance-usdm', symbol: null, levels: [] };
      }
      if (this.token?.id || this.token?.symbol) {
        this.demoRandom = seededRandom(hashString(this.token.id || this.token.symbol));
      }
    }

    setLayers(layers) {
      this.layers = { ...this.layers, ...(layers || {}) };
    }

    setMevAlert(alert) {
      if (!alert || alert.active === false || alert.clear === true) {
        this.mevAlert = null;
        return false;
      }
      const observedAt = transactionTimestamp(alert.observedAt ?? alert.timestamp);
      const expiresInMs = clamp(finite(alert.expiresInMs, 15_000), 1000, 120_000);
      this.mevAlert = {
        active: true,
        type: boundedText(alert.type || alert.kind || 'MEV / SANDWICH RISK', 40),
        source: boundedText(alert.source || alert.provider || 'external detector', 48),
        pairAddress: boundedText(alert.pairAddress || alert.dexPairAddress || alert.poolAddress || alert.pair?.address || alert.pair || '', 48),
        txHash: boundedText(alert.pendingTxHash || alert.txHash || alert.transactionHash || alert.hash || '', 40),
        reason: boundedText(alert.reason || 'Connected detector reported suspicious pending orderflow.', 100),
        confidence: boundedText(alert.confidence ?? (alert.credible ? 'credible' : 'unverified'), 24),
        observedAt,
        expiresAt: observedAt + expiresInMs,
      };
      return true;
    }

    setLiquidationHeatmap(snapshot) {
      this.liquidationHeatmap = snapshot || { status: 'disabled', source: null, symbol: null, levels: [] };
    }

    setData(data, config = {}) {
      const source = String(data?.source || config.source || 'live').toLowerCase();
      this.source = source;
      this.security = data?.security || null;
      this.dataStatus = data?.dataStatus || null;
      this.totalSupplyPct = Math.max(0.01, finite(data?.totalSupplyPct, 100));
      const rows = normalizeHolders({
        holders: data?.holders,
        totalSupplyPct: this.totalSupplyPct,
      }, source);
      this.buildSites(rows, config.preservePositions !== false);
      this.balanceWeights(this.quality.initialBalanceIterations);
      this.canvas.dataset.nodeclusterSource = source;
      this.canvas.dataset.nodeclusterHolderCount = String(rows.length);
      this.nextDemoPulseAt = now() + 900;
    }

    buildSites(rows, preservePositions) {
      const previous = new Map(this.sites.map((site) => [site.id, site]));
      const count = rows.length;
      this.sites = rows.map((row, index) => {
        const old = preservePositions ? previous.get(row.id) : null;
        const random = seededRandom(hashString(row.id));
        const radial = Math.sqrt((index + 0.5) / Math.max(1, count));
        const angle = index * GOLDEN_ANGLE + (random() - 0.5) * 0.42;
        const nx = old?.nx ?? clamp(0.5 + Math.cos(angle) * radial * 0.43, 0.035, 0.965);
        const ny = old?.ny ?? clamp(0.5 + Math.sin(angle) * radial * 0.43, 0.045, 0.955);
        const targetArea = (row.sharePct / this.totalSupplyPct) * this.width * this.height;
        return {
          ...row,
          x: old?.x ?? nx * this.width,
          y: old?.y ?? ny * this.height,
          nx,
          ny,
          homeNx: old?.homeNx ?? nx,
          homeNy: old?.homeNy ?? ny,
          homeX: (old?.homeNx ?? nx) * this.width,
          homeY: (old?.homeNy ?? ny) * this.height,
          vx: old?.vx ?? 0,
          vy: old?.vy ?? 0,
          ax: 0,
          ay: 0,
          weight: old?.weight ?? Math.max(0, targetArea * 0.035 - (this.width * this.height) / count * 0.035),
          targetArea,
          paletteIndex: old?.paletteIndex ?? (hashString(row.id) % PALETTE.length),
          phase: old?.phase ?? random() * TAU,
          activeUntil: old?.activeUntil ?? 0,
          impactX: old?.impactX ?? nx * this.width,
          impactY: old?.impactY ?? ny * this.height,
          cracks: old?.cracks ?? [],
          lastTransaction: old?.lastTransaction ?? null,
        };
      });
      this.cells = calculatePowerCells(this.sites, this.width, this.height);
      this.insiderSharePct = this.sites.reduce((total, site) => (
        site.isOther || !isInsiderSite(site) ? total : total + site.sharePct
      ), 0);
      this.reconcileFlowEdges();
    }

    reconcileFlowEdges() {
      const addresses = new Set(this.sites.map((site) => site.id));
      const cutoff = Date.now() - FLOW_RETENTION_MS;
      for (const [key, edge] of this.flowEdges.entries()) {
        if (edge.timestamp < cutoff || !addresses.has(edge.fromId) || !addresses.has(edge.toId)) this.flowEdges.delete(key);
      }
    }

    setPerformanceQuality(index) {
      const nextIndex = clamp(Math.trunc(index), this.minimumQualityTier, PERFORMANCE_QUALITY.length - 1);
      if (nextIndex === this.qualityTierIndex) return;
      this.qualityTierIndex = nextIndex;
      this.quality = PERFORMANCE_QUALITY[nextIndex];
      this.canvas.dataset.nodeclusterQuality = this.quality.name;
      if (this.particles.length > this.quality.maxParticles) {
        this.particles.splice(0, this.particles.length - this.quality.maxParticles);
      }
      if (!this.staticRender) this.resize();
    }

    setTargetFps(targetFps, frameTimestamp = now()) {
      const next = clamp(Math.round(targetFps), 30, TARGET_FPS);
      if (next === this.targetFps) return;
      this.targetFps = next;
      this.nextRenderAt = frameTimestamp + 1000 / next;
    }

    recordFrameCost(frameCostMs, frameIntervalMs, frameTimestamp) {
      if (!Number.isFinite(frameCostMs) || frameCostMs < 0) return;
      this.frameCostEwma = this.frameCostEwma == null
        ? frameCostMs
        : this.frameCostEwma * 0.85 + frameCostMs * 0.15;
      if (Number.isFinite(frameIntervalMs) && frameIntervalMs > 0) {
        this.frameIntervalEwma = this.frameIntervalEwma == null
          ? frameIntervalMs
          : this.frameIntervalEwma * 0.85 + frameIntervalMs * 0.15;
      }

      const slowMobileFps = this.mobileOptimized && this.frameIntervalEwma != null
        && this.frameIntervalEwma > MOBILE_SLOW_FRAME_MS;
      if (slowMobileFps) {
        if (this.below45StartedAt == null) this.below45StartedAt = frameTimestamp - frameIntervalMs;
        this.below45DurationMs = Math.max(0, frameTimestamp - this.below45StartedAt);
        if (this.below45DurationMs >= 1000 && this.targetFps > MOBILE_FPS_FLOOR) {
          this.setTargetFps(MOBILE_FPS_FLOOR, frameTimestamp);
        }
        if (this.below45DurationMs >= 3000) {
          this.mobilePerformanceFloorApplied = true;
          this.setPerformanceQuality(PERFORMANCE_QUALITY.length - 1);
        }
        if (this.below45DurationMs >= 4200 && this.frameIntervalEwma > 1000 / 32) {
          this.setTargetFps(30, frameTimestamp);
        }
      } else {
        this.below45StartedAt = null;
        this.below45DurationMs = 0;
        this.mobilePerformanceFloorApplied = false;
      }

      const frameBudgetMs = 1000 / this.targetFps;
      const overloaded = frameCostMs >= frameBudgetMs * 0.9
        || this.frameCostEwma >= 13.5
        || (this.frameIntervalEwma != null && this.frameIntervalEwma > frameBudgetMs * 1.12);
      this.slowFrameCount = overloaded ? this.slowFrameCount + 1 : 0;
      const comfortablyFast = frameCostMs < 9 && this.frameCostEwma < 9.5
        && (this.frameIntervalEwma == null || this.frameIntervalEwma <= frameBudgetMs * 1.08);
      this.fastFrameCount = comfortablyFast ? this.fastFrameCount + 1 : 0;

      if (this.slowFrameCount >= 8 && this.qualityTierIndex < PERFORMANCE_QUALITY.length - 1) {
        this.slowFrameCount = 0;
        this.fastFrameCount = 0;
        this.setPerformanceQuality(this.qualityTierIndex + 1);
      } else if (this.fastFrameCount >= 180) {
        this.slowFrameCount = 0;
        this.fastFrameCount = 0;
        if (this.targetFps < TARGET_FPS) this.setTargetFps(TARGET_FPS, frameTimestamp);
        else if (this.qualityTierIndex > this.minimumQualityTier) this.setPerformanceQuality(this.qualityTierIndex - 1);
      }
    }

    performanceState() {
      const frameCostMs = this.frameCostEwma;
      const estimatedFps = this.frameIntervalEwma == null
        ? this.targetFps
        : Math.round(1000 / this.frameIntervalEwma);
      return {
        mobileOptimized: this.mobileOptimized,
        targetFps: this.targetFps,
        quality: this.quality.name,
        estimatedRenderFps: Math.min(this.targetFps, estimatedFps),
        frameCostMs: frameCostMs == null ? null : Math.round(frameCostMs * 10) / 10,
        below45DurationMs: Math.round(this.below45DurationMs),
        mobilePerformanceFloorApplied: this.mobilePerformanceFloorApplied,
        maxCellVertices: this.quality.maxCellVertices,
        maxParticles: this.quality.maxParticles,
        shadowScale: this.quality.shadowScale,
        renderedFrames: this.renderedFrames,
        zoomScale: Math.round(this.viewScale * 100) / 100,
      };
    }

    clampViewTransform() {
      this.viewScale = clamp(this.viewScale, 1, 3);
      this.viewOffsetX = clamp(this.viewOffsetX, this.width * (1 - this.viewScale), 0);
      this.viewOffsetY = clamp(this.viewOffsetY, this.height * (1 - this.viewScale), 0);
    }

    screenToWorld(point) {
      return {
        x: (point.x - this.viewOffsetX) / this.viewScale,
        y: (point.y - this.viewOffsetY) / this.viewScale,
      };
    }

    beginPinch() {
      const pointers = [...this.activePointers.entries()]
        .filter(([, point]) => point.pointerType === 'touch')
        .slice(0, 2);
      if (pointers.length < 2) return false;
      const [firstId, first] = pointers[0];
      const [secondId, second] = pointers[1];
      const midpoint = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
      this.pinch = {
        pointerIds: [firstId, secondId],
        startDistance: Math.max(1, Math.hypot(second.x - first.x, second.y - first.y)),
        startScale: this.viewScale,
        anchorWorld: this.screenToWorld(midpoint),
      };
      this.drag = null;
      this.hovered = null;
      this.canvas.style.cursor = 'default';
      return true;
    }

    updatePinch() {
      if (!this.pinch) return;
      const [first, second] = this.pinch.pointerIds.map((id) => this.activePointers.get(id));
      if (!first || !second) {
        this.beginPinch();
        return;
      }
      const distance = Math.max(1, Math.hypot(second.x - first.x, second.y - first.y));
      const midpoint = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
      this.viewScale = clamp(this.pinch.startScale * (distance / this.pinch.startDistance), 1, 3);
      this.viewOffsetX = midpoint.x - this.pinch.anchorWorld.x * this.viewScale;
      this.viewOffsetY = midpoint.y - this.pinch.anchorWorld.y * this.viewScale;
      this.clampViewTransform();
    }

    zoomAt(point, factor) {
      const anchorWorld = this.screenToWorld(point);
      this.viewScale = clamp(this.viewScale * factor, 1, 3);
      this.viewOffsetX = point.x - anchorWorld.x * this.viewScale;
      this.viewOffsetY = point.y - anchorWorld.y * this.viewScale;
      this.clampViewTransform();
    }

    resize() {
      if (this.destroyed || !this.canvas) return;
      if (!this.staticRender) {
        const mobile = isMobileTouchViewport();
        if (mobile !== this.mobileOptimized) {
          this.mobileOptimized = mobile;
          this.minimumQualityTier = mobile ? 1 : 0;
          if (this.qualityTierIndex < this.minimumQualityTier) {
            this.qualityTierIndex = this.minimumQualityTier;
            this.quality = PERFORMANCE_QUALITY[this.qualityTierIndex];
          }
        }
      }
      this.canvas.dataset.nodeclusterQuality = this.quality.name;
      if (this.mobileOptimized) this.canvas.dataset.nodeclusterMobileOptimized = 'true';
      else delete this.canvas.dataset.nodeclusterMobileOptimized;

      const rect = this.canvas.getBoundingClientRect();
      const nextWidth = Math.max(1, rect.width || this.canvas.clientWidth || 1);
      const nextHeight = Math.max(1, rect.height || this.canvas.clientHeight || 1);
      const deviceDpr = clamp(finite(window.devicePixelRatio, 1), 1, 3);
      const nextDpr = this.exportDpr ?? Math.min(deviceDpr, this.quality.maxDpr);
      const pixelWidth = Math.max(1, Math.round(nextWidth * nextDpr));
      const pixelHeight = Math.max(1, Math.round(nextHeight * nextDpr));
      const changed = Math.abs(nextWidth - this.width) > 0.5
        || Math.abs(nextHeight - this.height) > 0.5
        || nextDpr !== this.dpr
        || this.canvas.width !== pixelWidth
        || this.canvas.height !== pixelHeight;
      if (!changed) {
        this.clampViewTransform();
        return;
      }

      this.width = nextWidth;
      this.height = nextHeight;
      this.dpr = nextDpr;
      if (this.canvas.width !== pixelWidth) this.canvas.width = pixelWidth;
      if (this.canvas.height !== pixelHeight) this.canvas.height = pixelHeight;
      this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

      for (const site of this.sites) {
        site.x = site.nx * this.width;
        site.y = site.ny * this.height;
        site.homeX = site.homeNx * this.width;
        site.homeY = site.homeNy * this.height;
        site.targetArea = (site.sharePct / this.totalSupplyPct) * this.width * this.height;
        site.weight = 0;
      }
      this.clampViewTransform();
      if (this.sites.length > 0) this.balanceWeights(this.quality.resizeBalanceIterations);
    }

    balanceWeights(iterations = 1) {
      if (this.sites.length === 0 || this.width <= 1 || this.height <= 1) return;
      const fullArea = this.width * this.height;
      for (let iteration = 0; iteration < iterations; iteration += 1) {
        const cells = calculatePowerCells(this.sites, this.width, this.height);
        for (const cell of cells) {
          const delta = cell.site.targetArea - cell.area;
          // A conservative gradient avoids alternating between two wildly
          // different diagrams on narrow/tall viewports.
          const adjustment = clamp(delta * 0.2, -fullArea * 0.12, fullArea * 0.12);
          cell.site.weight += adjustment;
          if (cell.area < 1) cell.site.weight += cell.site.targetArea * 0.12;
        }
        const mean = this.sites.reduce((sum, site) => sum + site.weight, 0) / this.sites.length;
        for (const site of this.sites) site.weight -= mean;
      }
      this.cells = calculatePowerCells(this.sites, this.width, this.height);
    }

    pointerPosition(event) {
      const rect = this.canvas.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    }

    hitTest(point) {
      for (let i = this.cells.length - 1; i >= 0; i -= 1) {
        const cell = this.cells[i];
        if (this.layers.hideCex && cell.site.isCex) continue;
        if (cell.points.length >= 3 && pointInPolygon(point, cell.points)) return cell;
      }
      return null;
    }

    onPointerDown(event) {
      if (event.button !== undefined && event.button !== 0) return;
      const pointerId = event.pointerId ?? 1;
      const point = this.pointerPosition(event);
      const pointerType = event.pointerType || 'mouse';
      this.activePointers.set(pointerId, { ...point, pointerType });
      if (this.canvas.setPointerCapture && event.pointerId != null) {
        try { this.canvas.setPointerCapture(event.pointerId); } catch { /* capture may be unavailable */ }
      }

      const touchCount = [...this.activePointers.values()].filter((pointer) => pointer.pointerType === 'touch').length;
      if (pointerType === 'touch' && touchCount >= 2) {
        event.preventDefault();
        this.beginPinch();
        return;
      }

      const worldPoint = this.screenToWorld(point);
      const cell = this.hitTest(worldPoint);
      if (!cell) return;
      event.preventDefault();
      this.hovered = cell.site;
      this.drag = {
        pointerId,
        site: cell.site,
        offsetX: cell.site.x - worldPoint.x,
        offsetY: cell.site.y - worldPoint.y,
        lastX: worldPoint.x,
        lastY: worldPoint.y,
        startX: worldPoint.x,
        startY: worldPoint.y,
        moved: false,
        lastAt: now(),
        vx: 0,
        vy: 0,
      };
      cell.site.vx = 0;
      cell.site.vy = 0;
      this.canvas.style.cursor = 'grabbing';
    }

    onPointerMove(event) {
      const pointerId = event.pointerId ?? 1;
      const point = this.pointerPosition(event);
      const activePointer = this.activePointers.get(pointerId);
      if (activePointer) this.activePointers.set(pointerId, { ...point, pointerType: activePointer.pointerType });

      const touchCount = [...this.activePointers.values()].filter((pointer) => pointer.pointerType === 'touch').length;
      if (touchCount >= 2) {
        event.preventDefault();
        if (!this.pinch) this.beginPinch();
        this.updatePinch();
        return;
      }

      if (this.pinch) this.pinch = null;
      const worldPoint = this.screenToWorld(point);
      if (this.drag && this.drag.pointerId === pointerId) {
        event.preventDefault();
        const drag = this.drag;
        const time = now();
        if (Math.hypot(worldPoint.x - drag.startX, worldPoint.y - drag.startY) > 7) drag.moved = true;
        const elapsed = Math.max(8, time - drag.lastAt);
        const targetX = clamp(worldPoint.x + drag.offsetX, 2, this.width - 2);
        const targetY = clamp(worldPoint.y + drag.offsetY, 2, this.height - 2);
        drag.vx = ((worldPoint.x - drag.lastX) / elapsed) * 1000;
        drag.vy = ((worldPoint.y - drag.lastY) / elapsed) * 1000;
        drag.lastX = worldPoint.x;
        drag.lastY = worldPoint.y;
        drag.lastAt = time;
        drag.site.x = targetX;
        drag.site.y = targetY;
        drag.site.nx = targetX / this.width;
        drag.site.ny = targetY / this.height;
        drag.site.vx = drag.vx;
        drag.site.vy = drag.vy;
        return;
      }

      const cell = this.hitTest(worldPoint);
      const nextHovered = cell?.site || null;
      if (nextHovered !== this.hovered) {
        this.hovered = nextHovered;
        this.canvas.style.cursor = nextHovered ? 'grab' : 'default';
      }
    }

    onPointerUp(event) {
      const pointerId = event.pointerId ?? 1;
      const wasPinching = Boolean(this.pinch);
      const drag = this.drag && this.drag.pointerId === pointerId ? this.drag : null;
      let wasClick = false;
      if (drag) {
        const point = this.screenToWorld(this.pointerPosition(event));
        wasClick = !drag.moved && Math.hypot(point.x - drag.startX, point.y - drag.startY) <= 7;
        drag.site.vx = clamp(drag.vx * 1.12, -980, 980);
        drag.site.vy = clamp(drag.vy * 1.12, -980, 980);
        drag.site.nx = drag.site.x / this.width;
        drag.site.ny = drag.site.y / this.height;
        this.drag = null;
      }
      this.activePointers.delete(pointerId);
      const remainingTouches = [...this.activePointers.values()].filter((pointer) => pointer.pointerType === 'touch').length;
      if (wasPinching && remainingTouches >= 2) this.beginPinch();
      else this.pinch = null;
      this.canvas.style.cursor = this.drag ? 'grabbing' : this.hovered ? 'grab' : 'default';
      if (wasClick && !wasPinching && drag) this.selectShard(drag.site);
    }

    onPointerCancel(event) {
      const pointerId = event.pointerId ?? 1;
      this.activePointers.delete(pointerId);
      if (this.drag?.pointerId === pointerId) this.drag = null;
      if (this.pinch?.pointerIds.includes(pointerId)) this.pinch = null;
      const remainingTouches = [...this.activePointers.values()].filter((pointer) => pointer.pointerType === 'touch').length;
      if (remainingTouches >= 2) this.beginPinch();
      this.hovered = null;
      this.canvas.style.cursor = 'default';
    }

    onWheel(event) {
      if (!Number.isFinite(Number(event.deltaY)) || event.deltaY === 0) return;
      event.preventDefault();
      const factor = Math.exp(-Number(event.deltaY) * 0.0015);
      this.zoomAt(this.pointerPosition(event), factor);
    }

    selectShard(site) {
      if (!site) return false;
      window.dispatchEvent(new CustomEvent('nodecluster:shard-select', {
        detail: {
          address: site.address,
          label: site.label,
          sharePct: site.sharePct,
          venue: site.venue,
          classification: site.classification || 'STANDARD',
          confidence: site.confidence || 'unverified',
          risk: Boolean(site.risk),
          isMintable: Boolean(site.isMintable),
          isHoneypot: Boolean(site.isHoneypot),
          isUnlocked: Boolean(site.isUnlocked),
          isInsider: Boolean(site.isInsider),
          riskReasons: Array.isArray(site.riskReasons) ? site.riskReasons.slice(0, 5) : [],
          tags: Array.isArray(site.tags) ? site.tags.slice(0, 8) : [],
          chain: this.token?.chain || null,
          tokenId: this.token?.id || null,
        },
      }));
      return true;
    }

    activateShard(site, transaction = {}) {
      if (!site) return false;
      const timestamp = now();
      const center = this.cells.find((cell) => cell.site === site)?.center || { x: site.x, y: site.y };
      const x = clamp(finite(transaction.x, center.x), 0, this.width);
      const y = clamp(finite(transaction.y, center.y), 0, this.height);
      const amount = Math.max(0, finite(transaction.amountUsd, 0));
      const intensity = clamp(0.72 + Math.log10(Math.max(1, amount)) / 14, 0.7, 1.65);
      const random = seededRandom(hashString(`${site.id}:${timestamp}:${amount}`));
      site.activeUntil = timestamp + 1350;
      site.impactX = x;
      site.impactY = y;
      site.lastTransaction = {
        amountUsd: amount || null,
        side: String(transaction.side || 'unknown'),
        txHash: transaction.txHash ? String(transaction.txHash) : null,
        at: timestamp,
      };
      site.cracks = Array.from({ length: 7 + Math.floor(random() * 6) }, () => ({
        angle: random() * TAU,
        reach: 0.28 + random() * 0.68,
        branch: random() > 0.48,
      }));

      const particleCount = Math.min(this.quality.particleBurst, Math.round(10 + intensity * 9));
      for (let i = 0; i < particleCount; i += 1) {
        const angle = random() * TAU;
        const speed = (70 + random() * 260) * intensity;
        const life = 0.42 + random() * 0.64;
        this.particles.push({
          x,
          y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          life,
          maxLife: life,
          size: 2.4 + random() * 5.8,
          angle: random() * TAU,
          spin: (random() - 0.5) * 8,
          tint: random() > 0.55 ? '#39FF14' : random() > 0.45 ? '#FF007F' : '#D8A5FF',
        });
      }
      if (this.particles.length > this.quality.maxParticles) {
        this.particles.splice(0, this.particles.length - this.quality.maxParticles);
      }
      return true;
    }

    registerFlow(transaction = {}) {
      const fromAddress = String(transaction.fromAddress ?? transaction.from ?? transaction.sender ?? '').trim().toLowerCase();
      const toAddress = String(transaction.toAddress ?? transaction.to ?? transaction.recipient ?? '').trim().toLowerCase();
      if (!fromAddress || !toAddress || fromAddress === toAddress) return null;
      const fromSite = this.sites.find((site) => site.id === fromAddress || site.address.toLowerCase() === fromAddress);
      const toSite = this.sites.find((site) => site.id === toAddress || site.address.toLowerCase() === toAddress);
      if (!fromSite || !toSite || fromSite.isOther || toSite.isOther) return null;

      const incomingTimestamp = transactionTimestamp(transaction.timestamp ?? transaction.at ?? transaction.time);
      const key = `${fromSite.id}->${toSite.id}`;
      const previous = this.flowEdges.get(key);
      const timestamp = Math.max(incomingTimestamp, previous?.timestamp || 0);
      const ageMs = Math.max(0, Date.now() - timestamp);
      if (ageMs > FLOW_RETENTION_MS) return null;
      const amountUsd = Math.max(0, finite(transaction.amountUsd ?? transaction.valueUsd, previous?.amountUsd || 0));
      const edge = {
        key,
        fromId: fromSite.id,
        toId: toSite.id,
        fromAddress: fromSite.address,
        toAddress: toSite.address,
        timestamp,
        amountUsd,
        txHash: boundedText(transaction.txHash || transaction.hash || '', 96),
        side: boundedText(transaction.side || 'transfer', 16),
        speedPxPerSecond: flowSpeedPxPerSecond(ageMs),
        phaseOffset: previous?.phaseOffset ?? (hashString(`${key}:${timestamp}`) / 4294967296),
        count: (previous?.count || 0) + 1,
      };
      this.flowEdges.set(key, edge);
      if (this.flowEdges.size > 120) {
        const oldestKey = [...this.flowEdges.entries()].sort((a, b) => a[1].timestamp - b[1].timestamp)[0]?.[0];
        if (oldestKey) this.flowEdges.delete(oldestKey);
      }
      return { edge, fromSite, toSite };
    }

    pushTransaction(transaction = {}) {
      if (transaction.mevAlert || transaction.sandwichDetected) {
        const nestedSignal = transaction.mevAlert && typeof transaction.mevAlert === 'object' ? transaction.mevAlert : {};
        const signal = {
          ...transaction,
          ...nestedSignal,
          type: nestedSignal.type || transaction.type || transaction.kind || (transaction.sandwichDetected ? 'sandwich' : ''),
          reason: nestedSignal.reason || transaction.mevReason || transaction.reason,
        };
        if (isCredibleMevSignal(signal)) this.setMevAlert(signal);
      }

      const flow = this.registerFlow(transaction);
      if (flow) {
        this.activateShard(flow.toSite, transaction);
        return true;
      }
      const address = String(transaction.address ?? transaction.holderId ?? transaction.id ?? '').toLowerCase();
      if (!address) return false;
      const site = this.sites.find((item) => item.id === address || item.address.toLowerCase() === address);
      return this.activateShard(site, transaction);
    }

    updatePhysics(dt, timestamp) {
      const minDimension = Math.min(this.width, this.height);
      const preferredSpacing = minDimension / Math.max(3.4, Math.sqrt(this.sites.length) * 1.65);

      // Soft site-site repulsion makes nearby cells flex apart while remaining
      // a true edge-to-edge power diagram (no circles or overlapping bubbles).
      for (const site of this.sites) {
        site.ax = 0;
        site.ay = 0;
      }
      for (let i = 0; i < this.sites.length; i += 1) {
        const a = this.sites[i];
        for (let j = i + 1; j < this.sites.length; j += 1) {
          const b = this.sites[j];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const distance = Math.sqrt(dx * dx + dy * dy) || 0.001;
          const overlap = preferredSpacing - distance;
          if (overlap <= 0) continue;
          const force = overlap * 1.25;
          const fx = (dx / distance) * force;
          const fy = (dy / distance) * force;
          if (!this.drag || this.drag.site !== a) { a.ax -= fx; a.ay -= fy; }
          if (!this.drag || this.drag.site !== b) { b.ax += fx; b.ay += fy; }
        }
      }

      for (const site of this.sites) {
        if (this.drag?.site === site) continue;
        // Elastic home spring plus critically damped velocity and a little
        // neighbor repulsion: flung shards settle back instead of drifting.
        site.ax += (site.homeX - site.x) * 10.5;
        site.ay += (site.homeY - site.y) * 10.5;
        const damping = 5.8;
        site.vx = (site.vx + site.ax * dt) * Math.exp(-damping * dt);
        site.vy = (site.vy + site.ay * dt) * Math.exp(-damping * dt);
        site.x += site.vx * dt;
        site.y += site.vy * dt;

        const margin = Math.min(18, minDimension * 0.025);
        if (site.x < margin) { site.x = margin; site.vx = Math.abs(site.vx) * 0.54; }
        if (site.x > this.width - margin) { site.x = this.width - margin; site.vx = -Math.abs(site.vx) * 0.54; }
        if (site.y < margin) { site.y = margin; site.vy = Math.abs(site.vy) * 0.54; }
        if (site.y > this.height - margin) { site.y = this.height - margin; site.vy = -Math.abs(site.vy) * 0.54; }
        site.nx = site.x / this.width;
        site.ny = site.y / this.height;
      }

      for (let i = this.particles.length - 1; i >= 0; i -= 1) {
        const particle = this.particles[i];
        particle.life -= dt;
        particle.vy += 90 * dt;
        particle.vx *= Math.exp(-1.15 * dt);
        particle.vy *= Math.exp(-0.7 * dt);
        particle.x += particle.vx * dt;
        particle.y += particle.vy * dt;
        particle.angle += particle.spin * dt;
        if (particle.life <= 0) this.particles.splice(i, 1);
      }

      if (this.source === 'demo' && timestamp >= this.nextDemoPulseAt) {
        const candidates = this.sites.filter((site) => !site.isOther && !site.isCex);
        if (candidates.length > 0) {
          const site = candidates[Math.floor(this.demoRandom() * candidates.length)];
          this.activateShard(site, { amountUsd: 125000 + this.demoRandom() * 900000, side: 'demo' });
        }
        this.nextDemoPulseAt = timestamp + 2400 + this.demoRandom() * 2700;
      }

      this.frame += 1;
      if (this.frame % this.quality.balanceEvery === 0) this.balanceWeights(1);
      else this.cells = calculatePowerCells(this.sites, this.width, this.height);
    }

    drawBackground() {
      const ctx = this.ctx;
      const gradient = ctx.createLinearGradient(0, 0, this.width, this.height);
      gradient.addColorStop(0, '#070A0D');
      gradient.addColorStop(0.52, '#09040F');
      gradient.addColorStop(1, '#05060B');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, this.width, this.height);

      ctx.save();
      ctx.globalAlpha = 0.12;
      ctx.strokeStyle = '#263333';
      ctx.lineWidth = 0.6;
      const grid = this.quality.gridStep;
      for (let x = 0.5; x < this.width; x += grid) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, this.height); ctx.stroke();
      }
      for (let y = 0.5; y < this.height; y += grid) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(this.width, y); ctx.stroke();
      }
      ctx.restore();

      const vignette = ctx.createRadialGradient(
        this.width * 0.5, this.height * 0.47, Math.min(this.width, this.height) * 0.16,
        this.width * 0.5, this.height * 0.5, Math.max(this.width, this.height) * 0.74,
      );
      vignette.addColorStop(0, 'rgba(0,0,0,0)');
      vignette.addColorStop(1, 'rgba(0,0,0,0.44)');
      ctx.fillStyle = vignette;
      ctx.fillRect(0, 0, this.width, this.height);

    }

    drawWatermark() {
      if (!this.watermarkEnabled || this.width < 180 || this.height < 90) return;
      const ctx = this.ctx;
      if (this.watermarkGrid) {
        const size = clamp(Math.min(this.width * 0.028, this.height * 0.075), 10, 20);
        const stepX = Math.max(190, this.width * 0.36);
        const stepY = Math.max(118, this.height * 0.34);
        ctx.save();
        ctx.globalAlpha = 0.13;
        ctx.fillStyle = '#BDEFFF';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = `600 ${size}px ui-monospace, SFMono-Regular, Menlo, monospace`;
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;
        for (let row = -1; row * stepY < this.height + stepY; row += 1) {
          for (let column = -1; column * stepX < this.width + stepX; column += 1) {
            ctx.save();
            ctx.translate(column * stepX, row * stepY);
            ctx.rotate(-Math.PI / 6);
            ctx.fillText('www.nodechart.cc', 0, 0, stepX * 0.92);
            ctx.restore();
          }
        }
        ctx.restore();
        return;
      }
      const size = clamp(Math.min(this.width * 0.034, this.height * 0.11), 14, 40);
      ctx.save();
      ctx.globalAlpha = 0.23;
      ctx.fillStyle = '#BDEFFF';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `600 ${size}px ui-monospace, SFMono-Regular, Menlo, monospace`;
      ctx.shadowColor = '#00D8FF';
      ctx.shadowBlur = 8 * this.quality.shadowScale;
      ctx.fillText('www.nodechart.cc', this.width * 0.5, this.height * 0.54, this.width * 0.78);
      ctx.restore();
    }

    drawInsiderNebula(timestamp) {
      if (!this.layers.showDevRisks || this.insiderSharePct <= INSIDER_NEBULA_THRESHOLD_PCT) return;
      const insiderCells = this.cells.filter((cell) => isInsiderSite(cell.site) && !cell.site.isOther);
      const hull = convexHull(insiderCells.flatMap((cell) => simplifyPolygonPoints(cell.points, this.quality.maxCellVertices)));
      if (hull.length < 3) return;
      const center = hull.reduce((sum, point) => ({ x: sum.x + point.x / hull.length, y: sum.y + point.y / hull.length }), { x: 0, y: 0 });
      const pulse = 0.68 + (Math.sin(timestamp * 0.0024) + 1) * 0.16;
      const pad = 11 + pulse * 8;
      const cloud = hull.map((point, index) => {
        const dx = point.x - center.x;
        const dy = point.y - center.y;
        const distance = Math.hypot(dx, dy) || 1;
        const waviness = 1.5 * Math.sin(timestamp * 0.004 + index * 1.9);
        return { x: center.x + dx / distance * (distance + pad + waviness), y: center.y + dy / distance * (distance + pad + waviness) };
      });
      const ctx = this.ctx;
      ctx.save();
      ctx.globalAlpha = 0.24 + pulse * 0.12;
      ctx.shadowColor = '#FF174D';
      ctx.shadowBlur = (34 + pulse * 24) * this.quality.shadowScale;
      const nebula = ctx.createRadialGradient(center.x, center.y, 8, center.x, center.y, Math.max(this.width, this.height) * 0.52);
      nebula.addColorStop(0, 'rgba(255,20,92,0.20)');
      nebula.addColorStop(0.58, 'rgba(172,35,255,0.12)');
      nebula.addColorStop(1, 'rgba(115,25,188,0.02)');
      ctx.fillStyle = nebula;
      tracePolygon(ctx, cloud);
      ctx.fill();
      ctx.globalAlpha = pulse * 0.76;
      ctx.shadowBlur = 20 * this.quality.shadowScale;
      ctx.strokeStyle = '#B832FF';
      ctx.lineWidth = 1.25;
      tracePolygon(ctx, cloud);
      ctx.stroke();
      ctx.restore();
    }

    drawCell(cell, timestamp) {
      if (cell.points.length < 3 || cell.area < 0.2) return;
      const { site, center } = cell;
      const points = simplifyPolygonPoints(cell.points, this.quality.maxCellVertices);
      if (this.layers.hideCex && site.isCex) return;

      const ctx = this.ctx;
      const palette = PALETTE[site.paletteIndex % PALETTE.length];
      const active = timestamp < site.activeUntil;
      const hovered = this.hovered === site;
      const whale = this.layers.highlightWhales && site.sharePct >= 5;
      const risk = this.layers.showDevRisks && site.risk;
      const pulse = active ? 0.65 + Math.sin(timestamp * 0.025 + site.phase) * 0.22 : 0;
      const bounds = boundsOf(points);

      ctx.save();
      tracePolygon(ctx, points);
      ctx.lineJoin = 'miter';
      ctx.lineCap = 'square';
      if (active || hovered || whale || risk) {
        ctx.shadowColor = risk ? '#FF334E' : active ? palette.core : whale ? '#39FF14' : palette.core;
        ctx.shadowBlur = (active ? 24 + pulse * 12 : hovered ? 16 : whale ? 9 : 12) * this.quality.shadowScale;
      }
      const fill = ctx.createLinearGradient(bounds.minX, bounds.minY, bounds.maxX || bounds.minX + 1, bounds.maxY || bounds.minY + 1);
      fill.addColorStop(0, palette.dark);
      fill.addColorStop(0.48, risk ? '#30091D' : '#10121A');
      fill.addColorStop(1, palette.dark);
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.shadowBlur = 0;

      // Crystal facets: edge-to-edge triangular planes clipped to the convex
      // Voronoi cell, giving each shard refractive depth without round bubbles.
      ctx.save();
      tracePolygon(ctx, points);
      ctx.clip();
      const random = seededRandom(hashString(site.id));
      for (let i = 0; i < points.length; i += this.quality.facetStride) {
        const a = points[i];
        const b = points[(i + this.quality.facetStride) % points.length];
        const mix = random();
        ctx.beginPath();
        ctx.moveTo(center.x, center.y);
        ctx.lineTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.closePath();
        ctx.globalAlpha = 0.055 + mix * 0.11 + (active ? pulse * 0.12 : 0);
        ctx.fillStyle = mix > 0.66 ? palette.light : mix > 0.32 ? palette.core : '#C6E8FF';
        ctx.fill();
      }

      // Refraction seams and subtle interior strata.
      ctx.globalAlpha = active ? 0.54 + pulse * 0.24 : 0.22;
      ctx.strokeStyle = palette.light;
      ctx.lineWidth = active ? 1.1 : 0.65;
      for (let i = 0; i < points.length; i += this.quality.seamStride) {
        const point = points[i];
        ctx.beginPath();
        ctx.moveTo(center.x, center.y);
        ctx.lineTo(point.x, point.y);
        ctx.stroke();
      }

      if (active && site.cracks.length > 0) this.drawShatterCracks(site, bounds, timestamp);
      ctx.restore();

      if (risk) this.drawRiskCorona(points, center, site, timestamp);
      if (site.isCex) this.drawCexShield(points, center, active);
      else {
        // Angular perimeter, brighter on high-supply, active, hovered, or risky shards.
        ctx.globalAlpha = risk ? 0.98 : active ? 0.92 : whale ? 0.86 : hovered ? 0.92 : 0.62;
        ctx.strokeStyle = risk ? '#FF334E' : (active || whale || hovered) ? palette.core : palette.light;
        ctx.lineWidth = risk || active || hovered ? 1.45 : whale ? 1.15 : 0.72;
        tracePolygon(ctx, points);
        ctx.stroke();
      }

      if (active || hovered || whale) this.drawVertexGlints(points, timestamp, palette);
      if (risk) this.drawRiskMark(center);
      if (cell.area > this.width * this.height * 0.0025 && bounds.width > 34 && bounds.height > 22) {
        this.drawLabel(site, center, bounds, active, risk);
      }
      ctx.restore();
    }

    drawRiskCorona(points, center, site, timestamp) {
      const ctx = this.ctx;
      const pulse = 0.72 + (Math.sin(timestamp * 0.006 + site.phase) + 1) * 0.14;
      const seed = hashString(site.id);
      const outer = points.map((point, index) => {
        const dx = point.x - center.x;
        const dy = point.y - center.y;
        const length = Math.hypot(dx, dy) || 1;
        const jag = (((Math.imul(seed ^ (index + 1), 0x45d9f3b) >>> 0) % 100) / 100 - 0.5) * 5.5;
        const pad = 7 + pulse * 4 + jag;
        return { x: center.x + (dx / length) * (length + pad), y: center.y + (dy / length) * (length + pad) };
      });
      ctx.save();
      ctx.globalAlpha = pulse;
      ctx.shadowColor = '#FF167A';
      ctx.shadowBlur = (20 + pulse * 14) * this.quality.shadowScale;
      ctx.strokeStyle = '#FF2C8E';
      ctx.lineWidth = 2.2 + pulse * 0.6;
      tracePolygon(ctx, outer);
      ctx.stroke();
      ctx.globalAlpha = pulse * 0.62;
      ctx.shadowBlur = 8 * this.quality.shadowScale;
      ctx.strokeStyle = '#FF465E';
      ctx.lineWidth = 0.9;
      tracePolygon(ctx, points);
      ctx.stroke();
      ctx.restore();
    }

    drawCexShield(points, center, active) {
      const ctx = this.ctx;
      const inset = points.map((point) => {
        const dx = center.x - point.x;
        const dy = center.y - point.y;
        const distance = Math.hypot(dx, dy) || 1;
        const offset = Math.min(2.2, distance * 0.035);
        return { x: point.x + dx / distance * offset, y: point.y + dy / distance * offset };
      });
      ctx.save();
      ctx.globalAlpha = active ? 0.98 : 0.88;
      ctx.strokeStyle = '#43E8FF';
      ctx.lineWidth = 2.1;
      ctx.shadowColor = '#1DBBFF';
      ctx.shadowBlur = (active ? 14 : 7) * this.quality.shadowScale;
      tracePolygon(ctx, points);
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 0.95;
      ctx.strokeStyle = '#3579FF';
      ctx.lineWidth = 0.85;
      tracePolygon(ctx, inset);
      ctx.stroke();
      ctx.restore();
    }

    drawShatterCracks(site, bounds, timestamp) {
      const ctx = this.ctx;
      const progress = clamp((site.activeUntil - timestamp) / 1350, 0, 1);
      const maxReach = Math.max(bounds.width, bounds.height) * 0.58 * (1.05 - progress * 0.18);
      ctx.save();
      ctx.globalAlpha = 0.38 + progress * 0.42;
      ctx.strokeStyle = '#F8FFF4';
      ctx.lineWidth = 0.85;
      ctx.shadowColor = '#FF007F';
      ctx.shadowBlur = 10 * this.quality.shadowScale;
      for (const crack of site.cracks) {
        const reach = maxReach * crack.reach;
        const endX = site.impactX + Math.cos(crack.angle) * reach;
        const endY = site.impactY + Math.sin(crack.angle) * reach;
        const midX = site.impactX + Math.cos(crack.angle + 0.12) * reach * 0.55;
        const midY = site.impactY + Math.sin(crack.angle + 0.12) * reach * 0.55;
        ctx.beginPath();
        ctx.moveTo(site.impactX, site.impactY);
        ctx.lineTo(midX, midY);
        ctx.lineTo(endX, endY);
        ctx.stroke();
        if (crack.branch) {
          ctx.globalAlpha *= 0.82;
          ctx.beginPath();
          ctx.moveTo(midX, midY);
          ctx.lineTo(midX + Math.cos(crack.angle + 0.85) * reach * 0.24, midY + Math.sin(crack.angle + 0.85) * reach * 0.24);
          ctx.stroke();
          ctx.globalAlpha /= 0.82;
        }
      }
      ctx.restore();
    }

    drawVertexGlints(points, timestamp, palette) {
      const ctx = this.ctx;
      ctx.save();
      const stride = points.length > 7 ? 2 : 1;
      for (let i = 0; i < points.length; i += stride) {
        const point = points[i];
        const size = 1.1 + (Math.sin(timestamp * 0.003 + i * 1.7) + 1) * 0.85;
        ctx.save();
        ctx.translate(point.x, point.y);
        ctx.rotate(Math.PI / 4);
        ctx.globalAlpha = 0.38 + size * 0.16;
        ctx.fillStyle = palette.light;
        ctx.fillRect(-size, -size, size * 2, size * 2);
        ctx.restore();
      }
      ctx.restore();
    }

    drawRiskMark(center) {
      const ctx = this.ctx;
      const size = 5;
      ctx.save();
      ctx.translate(center.x, center.y);
      ctx.strokeStyle = '#FF334E';
      ctx.lineWidth = 1.2;
      ctx.globalAlpha = 0.86;
      ctx.beginPath();
      ctx.moveTo(-size, -size); ctx.lineTo(size, size);
      ctx.moveTo(size, -size); ctx.lineTo(-size, size);
      ctx.stroke();
      ctx.restore();
    }

    drawLabel(site, center, bounds, active, risk) {
      const ctx = this.ctx;
      const address = site.isOther ? (site.label || 'OTHER') : (site.label || site.address);
      const label = String(address).length > 17 ? `${String(address).slice(0, 7)}…${String(address).slice(-5)}` : String(address);
      const minSide = Math.min(bounds.width, bounds.height);
      const fontSize = clamp(minSide * 0.105, 8, 13);
      const pctText = `${site.sharePct.toFixed(1)}%`;
      ctx.save();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.shadowColor = risk ? '#FF334E' : '#000000';
      ctx.shadowBlur = 5 * this.quality.shadowScale;
      ctx.fillStyle = risk ? '#FFD7DF' : active ? '#F4FFF1' : '#DCE9E8';
      ctx.font = `600 ${fontSize}px ui-monospace, SFMono-Regular, Menlo, monospace`;
      ctx.fillText(label.toUpperCase(), center.x, center.y - fontSize * 0.53, Math.max(20, bounds.width * 0.82));
      ctx.globalAlpha = 0.8;
      ctx.fillStyle = risk ? '#FF7186' : '#B4FF9E';
      ctx.font = `700 ${Math.max(8, fontSize * 0.88)}px ui-monospace, SFMono-Regular, Menlo, monospace`;
      ctx.fillText(pctText, center.x, center.y + fontSize * 0.72, Math.max(20, bounds.width * 0.6));
      ctx.restore();
    }

    drawParticles() {
      const ctx = this.ctx;
      for (const particle of this.particles) {
        const alpha = clamp(particle.life / particle.maxLife, 0, 1);
        const size = particle.size * (0.35 + alpha * 0.7);
        ctx.save();
        ctx.translate(particle.x, particle.y);
        ctx.rotate(particle.angle);
        ctx.globalAlpha = alpha;
        ctx.fillStyle = particle.tint;
        ctx.shadowColor = particle.tint;
        ctx.shadowBlur = 11 * alpha * this.quality.shadowScale;
        // Angular micro-shards, never circular particles.
        ctx.beginPath();
        ctx.moveTo(0, -size);
        ctx.lineTo(size * 0.54, size * 0.3);
        ctx.lineTo(-size * 0.38, size * 0.8);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
    }

    drawFlowParticles(timestamp) {
      if (this.flowEdges.size === 0) return;
      const cellsById = new Map(this.cells.map((cell) => [cell.site.id, cell]));
      const visibleEdges = [...this.flowEdges.values()]
        .filter((edge) => Date.now() - edge.timestamp <= FLOW_RETENTION_MS)
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, this.quality.maxFlowEdges);
      const ctx = this.ctx;

      for (const edge of visibleEdges) {
        const fromCell = cellsById.get(edge.fromId);
        const toCell = cellsById.get(edge.toId);
        if (!fromCell || !toCell) continue;
        if (this.layers.hideCex && (fromCell.site.isCex || toCell.site.isCex)) continue;
        const dx = toCell.center.x - fromCell.center.x;
        const dy = toCell.center.y - fromCell.center.y;
        const distance = Math.hypot(dx, dy);
        if (distance < 12) continue;

        const ageMs = Math.max(0, Date.now() - edge.timestamp);
        const speed = flowSpeedPxPerSecond(ageMs);
        const particleCount = clamp(2 + Math.floor(Math.log2(Math.max(1, edge.count))), 2, 5);
        const cycle = timestamp * 0.001 * speed / distance;
        const recent = ageMs <= 24 * 60 * 60 * 1000;
        const color = recent ? '#50F4D1' : '#A78BFA';
        const angle = Math.atan2(dy, dx);

        for (let index = 0; index < particleCount; index += 1) {
          const progress = ((cycle + edge.phaseOffset + index / particleCount) % 1 + 1) % 1;
          const x = fromCell.center.x + dx * progress;
          const y = fromCell.center.y + dy * progress;
          const size = recent ? 3.2 : 2.4;
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(angle);
          ctx.globalAlpha = 0.48 + (Math.sin(timestamp * 0.009 + index * 1.8) + 1) * 0.22;
          ctx.fillStyle = color;
          ctx.shadowColor = color;
          ctx.shadowBlur = (recent ? 11 : 6) * this.quality.shadowScale;
          // Moving arrowhead only: no static inter-wallet connector is drawn.
          ctx.beginPath();
          ctx.moveTo(size * 1.8, 0);
          ctx.lineTo(-size, -size * 0.82);
          ctx.lineTo(-size * 0.42, 0);
          ctx.lineTo(-size, size * 0.82);
          ctx.closePath();
          ctx.fill();
          ctx.restore();
        }
      }
    }

    drawLiquidationHeatmap(_timestamp) {
      if (!this.layers.liquidationHeatmap || this.width < 225 || this.height < 230) return;
      const snapshot = this.liquidationHeatmap || { status: 'disabled' };
      const panelWidth = clamp(this.width * 0.24, 116, 146);
      const panelHeight = Math.min(226, this.height - 52);
      const x = this.width - panelWidth - 8;
      const y = 44;
      const ctx = this.ctx;
      ctx.save();
      ctx.globalAlpha = 0.96;
      ctx.fillStyle = 'rgba(3,8,20,0.88)';
      ctx.fillRect(x, y, panelWidth, panelHeight);
      ctx.strokeStyle = 'rgba(99,102,241,0.5)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x, y, panelWidth, panelHeight);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.font = '700 7px ui-monospace, SFMono-Regular, Menlo, monospace';
      ctx.fillStyle = '#C4B5FD';
      ctx.fillText('LIQ RISK · MODEL', x + 7, y + 6, panelWidth - 14);
      ctx.font = '600 7px ui-monospace, SFMono-Regular, Menlo, monospace';
      ctx.fillStyle = 'rgba(203,213,225,0.82)';
      ctx.fillText(snapshot.symbol || 'BINANCE USDM', x + 7, y + 17, panelWidth - 14);

      if (snapshot.status !== 'available') {
        const statusLabel = snapshot.status === 'loading' ? 'FETCHING OI + DEPTH…'
          : snapshot.status === 'unsupported' ? 'NO USDT PERP SYMBOL'
            : snapshot.status === 'disabled' ? 'LAYER DISABLED' : 'FUTURES DATA OFFLINE';
        ctx.font = '600 7px ui-monospace, SFMono-Regular, Menlo, monospace';
        ctx.fillStyle = snapshot.status === 'unavailable' ? '#FDA4AF' : '#94A3B8';
        ctx.fillText(statusLabel, x + 7, y + 38, panelWidth - 14);
        ctx.restore();
        return;
      }

      const mark = snapshot.markPrice;
      const openInterest = snapshot.openInterestUsd;
      const openInterestLabel = openInterest >= 1e9 ? `$${(openInterest / 1e9).toFixed(1)}B OI`
        : openInterest >= 1e6 ? `$${(openInterest / 1e6).toFixed(1)}M OI`
          : `$${(openInterest / 1e3).toFixed(0)}K OI`;
      ctx.font = '600 7px ui-monospace, SFMono-Regular, Menlo, monospace';
      ctx.fillStyle = '#E2E8F0';
      ctx.fillText(`MARK ${finite(mark).toPrecision(6)}`, x + 7, y + 29, panelWidth - 14);

      const levels = Array.isArray(snapshot.levels) ? snapshot.levels : [];
      const sectionTop = y + 43;
      const sectionGap = Math.max(68, (panelHeight - 79) / 2);
      const drawSide = (side, label, color, startY) => {
        const sideLevels = levels.filter((level) => level.side === side).sort((a, b) => a.leverage - b.leverage);
        ctx.font = '700 7px ui-monospace, SFMono-Regular, Menlo, monospace';
        ctx.fillStyle = color;
        ctx.fillText(label, x + 7, startY, panelWidth - 14);
        sideLevels.forEach((level, index) => {
          const rowY = startY + 12 + index * 14;
          const barX = x + 72;
          const barWidth = Math.max(1, (panelWidth - 80) * clamp(level.intensity, 0, 1));
          ctx.font = '500 6.5px ui-monospace, SFMono-Regular, Menlo, monospace';
          ctx.fillStyle = 'rgba(203,213,225,0.84)';
          ctx.fillText(`${level.leverage}x · ${level.distancePct.toFixed(1)}%`, x + 7, rowY + 1, 62);
          ctx.fillStyle = 'rgba(148,163,184,0.18)';
          ctx.fillRect(barX, rowY, panelWidth - 80, 6);
          ctx.fillStyle = color;
          ctx.globalAlpha = 0.4 + clamp(level.intensity, 0, 1) * 0.58;
          ctx.fillRect(barX, rowY, barWidth, 6);
          ctx.globalAlpha = 0.96;
        });
      };
      drawSide('short', 'SHORT LIQ. · ABOVE', '#FF5B9E', sectionTop);
      drawSide('long', 'LONG LIQ. · BELOW', '#55E6D1', sectionTop + sectionGap);
      ctx.strokeStyle = 'rgba(148,163,184,0.24)';
      ctx.beginPath();
      ctx.moveTo(x + 7, y + panelHeight - 26);
      ctx.lineTo(x + panelWidth - 7, y + panelHeight - 26);
      ctx.stroke();
      ctx.font = '700 7px ui-monospace, SFMono-Regular, Menlo, monospace';
      ctx.fillStyle = '#E2E8F0';
      ctx.fillText(openInterestLabel, x + 7, y + panelHeight - 20, panelWidth - 14);
      ctx.font = '500 5.8px ui-monospace, SFMono-Regular, Menlo, monospace';
      ctx.fillStyle = 'rgba(203,213,225,0.65)';
      ctx.fillText('MODELED · OI SPLIT 50/50', x + 7, y + panelHeight - 9, panelWidth - 14);
      ctx.restore();
    }

    drawMevAlert(timestamp) {
      if (!this.layers.mevOverlay || !this.mevAlert) return;
      if (Date.now() >= this.mevAlert.expiresAt) {
        this.mevAlert = null;
        return;
      }
      const ctx = this.ctx;
      const width = Math.min(this.width - 28, this.width * 0.55, 310);
      const x = 14;
      const y = 48;
      const pulse = 0.72 + (Math.sin(timestamp * 0.014) + 1) * 0.14;
      ctx.save();
      ctx.globalAlpha = pulse;
      ctx.fillStyle = 'rgba(72,5,28,0.94)';
      ctx.fillRect(x, y, width, 32);
      ctx.strokeStyle = '#FF2D67';
      ctx.lineWidth = 1.2;
      ctx.shadowColor = '#FF0055';
      ctx.shadowBlur = 16 * this.quality.shadowScale;
      ctx.strokeRect(x, y, width, 32);
      ctx.shadowBlur = 0;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      const pairAddress = String(this.mevAlert.pairAddress || 'DEX pair');
      const pairLabel = pairAddress.length > 18 ? `${pairAddress.slice(0, 8)}…${pairAddress.slice(-6)}` : pairAddress;
      ctx.font = '800 8px ui-monospace, SFMono-Regular, Menlo, monospace';
      ctx.fillStyle = '#FFE4EC';
      ctx.fillText(`⚠ MEV ALERT · ${this.mevAlert.type}`, x + 8, y + 5, width - 16);
      ctx.font = '500 6px ui-monospace, SFMono-Regular, Menlo, monospace';
      ctx.fillStyle = 'rgba(255,190,207,0.88)';
      ctx.fillText(`${pairLabel} · ${this.mevAlert.source} · ${this.mevAlert.confidence}`, x + 8, y + 19, width - 16);
      ctx.restore();
    }

    drawHud(timestamp) {
      const ctx = this.ctx;
      const tokenLabel = this.token?.symbol ? String(this.token.symbol).toUpperCase() : 'TOKEN';
      ctx.save();
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.font = '600 9px ui-monospace, SFMono-Regular, Menlo, monospace';
      ctx.fillStyle = this.source === 'demo' ? 'rgba(255,192,221,0.76)' : 'rgba(202,255,184,0.78)';
      const sourceText = this.source === 'demo'
        ? 'ILLUSTRATIVE DEMO · SIMULATED FLOW'
        : this.dataStatus?.partial
          ? `TOP ${this.dataStatus.holderLimit || this.sites.length} ONLY · PARTIAL SNAPSHOT`
          : 'EXTERNAL HOLDER SNAPSHOT';
      ctx.fillText(sourceText, 14, 13, Math.max(90, this.width * 0.55));
      if (this.security) {
        const security = this.security;
        const mint = security.isMintable == null ? 'MINT ?' : security.isMintable ? 'MINT ON' : 'MINT OFF';
        const owner = security.ownershipRenounced == null
          ? (security.mintAuthorityRevoked == null ? 'OWNER ?' : security.mintAuthorityRevoked ? 'MINT AUTH REVOKED' : 'MINT AUTH ACTIVE')
          : security.ownershipRenounced ? 'OWNER RENOUNCED' : 'OWNER ACTIVE';
        const honeypot = security.isHoneypot == null ? 'SELL ?' : security.isHoneypot ? 'HONEYPOT RISK' : 'SELL NOT FLAGGED';
        const risky = security.isHoneypot === true || security.isMintable === true || Boolean(security.freezeAuthority);
        const knownSafe = security.status !== 'unavailable'
          && security.isHoneypot === false
          && security.isMintable === false
          && !security.freezeAuthority;
        ctx.textAlign = 'left';
        ctx.fillStyle = risky ? 'rgba(255,113,134,0.88)' : knownSafe ? 'rgba(180,255,158,0.82)' : 'rgba(255,207,117,0.82)';
        ctx.fillText(`SECURITY · ${mint} · ${owner} · ${honeypot}`, 14, 28, Math.max(100, this.width * 0.72));
      }
      ctx.textAlign = 'right';
      ctx.fillStyle = 'rgba(190,207,205,0.72)';
      ctx.fillText(`${tokenLabel}  /  ${this.sites.length} SHARDS`, this.width - 14, 13);
      if (this.layers.mevOverlay) {
        const mevActive = this.mevAlert && Date.now() < this.mevAlert.expiresAt;
        ctx.textAlign = 'right';
        ctx.fillStyle = mevActive
          ? `rgba(255,0,127,${0.5 + Math.sin(timestamp * 0.014) * 0.22})`
          : 'rgba(148,163,184,0.52)';
        ctx.fillText(mevActive ? 'MEV ALERT · SIGNAL' : 'MEV · EXTERNAL FEED', this.width - 14, 28);
      }
      if (this.brandText) {
        ctx.textAlign = 'left';
        ctx.textBaseline = 'bottom';
        ctx.font = '600 9px ui-monospace, SFMono-Regular, Menlo, monospace';
        ctx.fillStyle = 'rgba(205,234,244,0.78)';
        ctx.fillText(this.brandText, 14, this.height - 12, Math.max(80, this.width * 0.42));
      }
      ctx.restore();
    }

    draw(timestamp) {
      if (this.width <= 1 || this.height <= 1) return;
      const dt = clamp((timestamp - this.lastFrameAt) / 1000, 0.001, 0.04);
      this.lastFrameAt = timestamp;
      if (!this.staticRender) this.updatePhysics(dt, timestamp);
      this.drawBackground();

      const ctx = this.ctx;
      ctx.save();
      ctx.translate(this.viewOffsetX, this.viewOffsetY);
      ctx.scale(this.viewScale, this.viewScale);
      this.drawInsiderNebula(timestamp);
      for (const cell of this.cells) this.drawCell(cell, timestamp);
      this.drawFlowParticles(timestamp);
      this.drawParticles();
      ctx.restore();

      // Draw after opaque crystal fills so the exact watermark remains visible
      // in the live canvas and in both free/Pro PNG renders.
      this.drawWatermark();
      this.drawLiquidationHeatmap(timestamp);
      this.drawMevAlert(timestamp);
      this.drawHud(timestamp);

      if (this.firstFrame) {
        this.firstFrame = false;
        this.canvas.dataset.nodeclusterReady = 'true';
        if (!this.staticRender) {
          window.dispatchEvent(new CustomEvent('nodecluster:visualization-ready', {
            detail: {
              version: VERSION,
              source: this.source,
              token: this.token,
              holderCount: this.sites.length,
            },
          }));
        }
      }
    }

    loop(timestamp) {
      if (!this.running || this.destroyed) return;
      if (Number.isFinite(this.nextRenderAt) && timestamp + 0.25 < this.nextRenderAt) {
        this.rafId = window.requestAnimationFrame((time) => this.loop(time));
        return;
      }
      if (!Number.isFinite(this.nextRenderAt)) this.nextRenderAt = timestamp;
      const frameIntervalMs = Number.isFinite(this.lastDrawTimestamp)
        ? timestamp - this.lastDrawTimestamp : null;
      const frameStartedAt = now();
      this.draw(timestamp);
      this.renderedFrames += 1;
      this.lastDrawTimestamp = timestamp;
      const targetFrameIntervalMs = 1000 / this.targetFps;
      this.nextRenderAt += targetFrameIntervalMs;
      while (this.nextRenderAt <= timestamp) this.nextRenderAt += targetFrameIntervalMs;
      this.recordFrameCost(Math.max(0, now() - frameStartedAt), frameIntervalMs, timestamp);
      this.rafId = window.requestAnimationFrame((time) => this.loop(time));
    }

    start() {
      if (this.running || this.destroyed) return;
      this.running = true;
      this.lastFrameAt = now();
      this.lastDrawTimestamp = Number.NEGATIVE_INFINITY;
      this.nextRenderAt = Number.NEGATIVE_INFINITY;
      this.setTargetFps(TARGET_FPS, now());
      this.below45StartedAt = null;
      this.below45DurationMs = 0;
      this.mobilePerformanceFloorApplied = false;
      this.rafId = window.requestAnimationFrame((time) => this.loop(time));
    }

    onVisibilityChange() {
      if (document.hidden) {
        if (this.rafId) window.cancelAnimationFrame(this.rafId);
        this.rafId = 0;
        this.lastDrawTimestamp = Number.NEGATIVE_INFINITY;
        this.nextRenderAt = Number.NEGATIVE_INFINITY;
      } else if (this.running && !this.rafId) {
        this.lastFrameAt = now();
        this.lastDrawTimestamp = Number.NEGATIVE_INFINITY;
        this.nextRenderAt = Number.NEGATIVE_INFINITY;
        this.below45StartedAt = null;
        this.below45DurationMs = 0;
        this.mobilePerformanceFloorApplied = false;
        this.setTargetFps(TARGET_FPS, now());
        this.rafId = window.requestAnimationFrame((time) => this.loop(time));
      }
    }

    async exportPng(options = {}) {
      if (this.destroyed || this.width <= 1 || this.height <= 1 || typeof document?.createElement !== 'function') return null;
      const scale = clamp(finite(options.scale, 1), 1, 3);
      const proEntitled = await hasVerifiedProExportEntitlement();
      const watermarkGrid = !proEntitled;
      // The public API cannot disable free-tier branding; a Pro watermark choice
      // is honored only while the verified local proof marker and TxHash agree.
      const watermark = watermarkGrid || options.watermark !== false;
      const brandText = proEntitled ? boundedText(options.brandText || '', 40) : '';
      const exportCanvas = document.createElement('canvas');
      exportCanvas.style.cssText = `position:fixed;left:-12000px;top:0;width:${this.width}px;height:${this.height}px;opacity:0;pointer-events:none;`;
      if (document.body?.appendChild) document.body.appendChild(exportCanvas);
      let renderer = null;
      try {
        const holders = this.sites.map((site) => ({
          address: site.address,
          label: site.label,
          sharePct: site.sharePct,
          venue: site.venue,
          classification: site.classification,
          confidence: site.confidence,
          isCex: site.isCex,
          isPool: site.isPool,
          isOther: site.isOther,
          isInsider: site.isInsider,
          isUnlocked: site.isUnlocked,
          risk: site.risk,
          isMintable: site.isMintable,
          isHoneypot: site.isHoneypot,
          riskReasons: site.riskReasons,
          tags: site.tags,
        }));
        renderer = new CrystalEngine(exportCanvas, {
          token: this.token,
          layers: this.layers,
          data: {
            holders,
            totalSupplyPct: this.totalSupplyPct,
            source: this.source,
            security: this.security,
            dataStatus: this.dataStatus,
          },
          dpr: scale,
          staticRender: true,
          watermark,
          watermarkGrid,
          brandText,
        });

        const sourceById = new Map(this.sites.map((site) => [site.id, site]));
        const exportById = new Map(renderer.sites.map((site) => [site.id, site]));
        for (const [id, site] of exportById) {
          const source = sourceById.get(id);
          if (!source) continue;
          site.nx = source.nx;
          site.ny = source.ny;
          site.homeNx = source.homeNx;
          site.homeNy = source.homeNy;
          site.x = source.nx * renderer.width;
          site.y = source.ny * renderer.height;
          site.homeX = source.homeNx * renderer.width;
          site.homeY = source.homeNy * renderer.height;
          site.vx = 0;
          site.vy = 0;
          site.weight = source.weight;
          site.activeUntil = source.activeUntil;
          site.lastTransaction = source.lastTransaction ? { ...source.lastTransaction } : null;
          site.cracks = Array.isArray(source.cracks) ? source.cracks.map((crack) => ({ ...crack })) : [];
        }
        renderer.viewScale = this.viewScale;
        renderer.viewOffsetX = this.viewOffsetX;
        renderer.viewOffsetY = this.viewOffsetY;
        renderer.cells = this.cells.map((cell) => ({
          ...cell,
          site: exportById.get(cell.site.id),
          points: cell.points.map((point) => ({ ...point })),
          center: { ...cell.center },
        })).filter((cell) => cell.site);
        renderer.flowEdges = new Map([...this.flowEdges.entries()].map(([key, edge]) => [key, { ...edge }]));
        renderer.mevAlert = this.mevAlert ? { ...this.mevAlert } : null;
        renderer.liquidationHeatmap = this.liquidationHeatmap ? JSON.parse(JSON.stringify(this.liquidationHeatmap)) : null;
        renderer.insiderSharePct = this.insiderSharePct;
        renderer.nextDemoPulseAt = Number.POSITIVE_INFINITY;
        renderer.draw(now());
        return exportCanvas.toDataURL('image/png');
      } catch (error) {
        console.warn('[NodeCluster] PNG export failed:', error);
        return null;
      } finally {
        if (renderer) renderer.destroy();
        exportCanvas.remove?.();
      }
    }

    getState() {
      return {
        version: VERSION,
        mounted: true,
        source: this.source,
        token: this.token,
        layers: { ...this.layers },
        performance: this.performanceState(),
        security: this.security,
        dataStatus: this.dataStatus,
        liquidationHeatmap: this.liquidationHeatmap,
        mevAlert: this.mevAlert,
        flowEdges: [...this.flowEdges.values()].map((edge) => ({
          ...edge,
          ageMs: Math.max(0, Date.now() - edge.timestamp),
          speedPxPerSecond: flowSpeedPxPerSecond(Math.max(0, Date.now() - edge.timestamp)),
        })),
        insiderSharePct: this.insiderSharePct,
        insiderNebulaActive: this.layers.showDevRisks && this.insiderSharePct > INSIDER_NEBULA_THRESHOLD_PCT,
        holderCount: this.sites.length,
        holders: this.sites.map((site, index) => ({
          id: site.id,
          address: site.address,
          label: site.label,
          sharePct: site.sharePct,
          renderedAreaPct: this.width * this.height > 0 ? (this.cells[index]?.area / (this.width * this.height)) * 100 : 0,
          venue: site.venue,
          classification: site.classification || 'STANDARD',
          confidence: site.confidence || 'unverified',
          isCex: Boolean(site.isCex),
          isPool: Boolean(site.isPool),
          isOther: Boolean(site.isOther),
          isInsider: Boolean(site.isInsider || site.classification === 'DEV_RISK'),
          isUnlocked: Boolean(site.isUnlocked),
          risk: site.risk,
          isMintable: site.isMintable,
          isHoneypot: site.isHoneypot,
          riskReasons: site.riskReasons || [],
          tags: site.tags || [],
          active: now() < site.activeUntil,
        })),
      };
    }

    destroy() {
      if (this.destroyed) return;
      this.destroyed = true;
      this.running = false;
      if (this.rafId) window.cancelAnimationFrame(this.rafId);
      this.rafId = 0;
      if (this.resizeObserver) this.resizeObserver.disconnect();
      for (const pointerId of this.activePointers.keys()) {
        try { this.canvas.releasePointerCapture?.(pointerId); } catch { /* capture may already be released */ }
      }
      this.activePointers.clear();
      this.pinch = null;
      this.drag = null;
      this.canvas.removeEventListener('pointerdown', this.boundPointerDown);
      this.canvas.removeEventListener('pointermove', this.boundPointerMove);
      this.canvas.removeEventListener('pointerup', this.boundPointerUp);
      this.canvas.removeEventListener('pointercancel', this.boundPointerCancel);
      this.canvas.removeEventListener('lostpointercapture', this.boundPointerCancel);
      this.canvas.removeEventListener('wheel', this.boundWheel);
      document.removeEventListener('visibilitychange', this.boundVisibility);
      window.removeEventListener('resize', this.boundResize);
      this.canvas.style.touchAction = this.savedTouchAction;
      this.canvas.style.cursor = 'default';
      this.ctx.setTransform(1, 0, 0, 1, 0, 0);
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      delete this.canvas.dataset.nodeclusterReady;
      delete this.canvas.dataset.nodeclusterEngine;
      delete this.canvas.dataset.nodeclusterQuality;
      delete this.canvas.dataset.nodeclusterMobileOptimized;
    }
  }

  let engine = null;
  let pendingData = null;
  let pendingTransactions = [];
  let pendingMevAlert = null;
  let pendingLiquidationHeatmap = null;
  let activeToken = null;
  let activeLayers = { ...DEFAULT_LAYERS };

  function clearTokenVisualState() {
    pendingMevAlert = null;
    pendingLiquidationHeatmap = null;
    if (engine) {
      engine.setMevAlert(null);
      engine.setLiquidationHeatmap({ status: 'loading', source: 'binance-usdm', symbol: null, levels: [] });
    }
  }

  function setActiveToken(token) {
    if (!token) return false;
    const previousKey = activeToken ? dataKeyForToken(activeToken) : null;
    const nextKey = dataKeyForToken(token);
    const changed = previousKey !== nextKey;
    activeToken = token;
    if (engine) engine.setToken(token);
    if (changed) clearTokenVisualState();
    syncLiquidationPolling();
    return changed;
  }

  function findCanvas(detail) {
    if (detail?.canvas && typeof detail.canvas.getContext === 'function') return detail.canvas;
    if (detail?.canvasId) return document.getElementById(detail.canvasId);
    return document.getElementById('nodecluster-canvas');
  }

  function mount(detail = {}) {
    const canvas = findCanvas(detail);
    if (!canvas) return false;
    const previousKey = dataKeyForToken(activeToken);
    activeToken = detail.token || activeToken;
    activeLayers = { ...activeLayers, ...(detail.layers || {}) };
    const nextKey = dataKeyForToken(activeToken);
    if (nextKey !== previousKey) clearTokenVisualState();

    if (engine && engine.canvas === canvas) {
      if (detail.token) engine.setToken(detail.token);
      engine.setLayers(activeLayers);
      syncLiquidationPolling();
      if (detail.data || detail.holders) {
        setData(detail.data || { holders: detail.holders, source: detail.source || 'live' });
      } else if (nextKey !== previousKey && fetchConfig.autoFetch !== false) {
        void fetchTokenData(activeToken);
      }
      return true;
    }

    if (engine) engine.destroy();
    if (pendingData && lastDataTokenKey && lastDataTokenKey !== nextKey) {
      pendingData = null;
      lastDataTokenKey = null;
    }
    const explicitData = detail.data || (detail.holders ? { holders: detail.holders, source: detail.source || 'live' } : null);
    const hostSnapshotMatches = Boolean(pendingData && (!lastDataTokenKey || lastDataTokenKey === nextKey));
    const initialData = explicitData || (hostSnapshotMatches ? pendingData : null) || makeDemoData();
    try {
      engine = new CrystalEngine(canvas, {
        token: activeToken,
        layers: activeLayers,
        data: initialData,
      });
    } catch (error) {
      console.error('[NodeCluster] Canvas engine could not mount:', error);
      return false;
    }
    if (explicitData) setData(explicitData);
    else if (hostSnapshotMatches) lastDataTokenKey = nextKey;
    if (pendingMevAlert) engine.setMevAlert(pendingMevAlert);
    if (pendingLiquidationHeatmap) engine.setLiquidationHeatmap(pendingLiquidationHeatmap);
    engine.start();
    syncLiquidationPolling();
    for (const transaction of pendingTransactions) engine.pushTransaction(transaction);
    pendingTransactions = [];
    if (!explicitData && !hostSnapshotMatches && fetchConfig.autoFetch !== false) void fetchTokenData(activeToken);
    return true;
  }

  function unmount() {
    const cancelledFetch = Boolean(activeFetch);
    stopLiquidationPolling();
    if (activeFetch) activeFetch.controller.abort();
    activeFetch = null;
    fetchSequence += 1;
    if (cancelledFetch) updateFetchStatus({ status: 'idle', note: 'Fetch cancelled because NodeCluster was unmounted.' });
    if (engine) engine.destroy();
    engine = null;
  }

  function setData(data, config = {}) {
    if (activeFetch && !config.fromFetcher) {
      activeFetch.controller.abort();
      activeFetch = null;
      fetchSequence += 1;
    }
    const snapshot = data && !data.dataStatus
      ? {
        ...data,
        dataStatus: {
          partial: data.source !== 'demo',
          provider: data.source || 'host',
          holderLimit: Array.isArray(data.holders) ? data.holders.length : 0,
          note: data.source === 'demo' ? 'Illustrative demo data.' : 'Host-supplied holder snapshot; provider completeness is not verified.',
        },
      }
      : data;
    pendingData = snapshot || null;
    lastDataTokenKey = config.tokenKey || (activeToken ? dataKeyForToken(activeToken) : null);
    if (!config.fromFetcher && lastDataTokenKey) fetchCache.delete(lastDataTokenKey);
    if (engine && snapshot) engine.setData(snapshot, config);
    if (snapshot?.security) window.dispatchEvent(new CustomEvent('nodecluster:security-update', { detail: snapshot.security }));
    if (snapshot) {
      const holderCount = Array.isArray(snapshot.holders) ? snapshot.holders.length : 0;
      updateFetchStatus({
        status: snapshot.dataStatus?.partial ? 'partial' : 'success',
        source: snapshot.source || 'host', chain: resolveChain(activeToken)?.key || null,
        tokenId: activeToken?.id || null, holderCount,
        note: snapshot.dataStatus?.note || 'Using host-supplied holder snapshot.',
      });
      window.dispatchEvent(new CustomEvent('nodecluster:data-ready', {
        detail: { token: activeToken, source: snapshot.source || 'host', holders: holderCount },
      }));
    }
    return Boolean(snapshot);
  }

  function setHolders(holders, options = {}) {
    return setData({
      holders: Array.isArray(holders) ? holders : [],
      totalSupplyPct: finite(options.totalSupplyPct, 100),
      source: options.source || 'live',
      security: options.security || null,
      dataStatus: options.dataStatus || null,
    }, options);
  }

  function setMevAlert(alert) {
    const clearing = !alert || alert.active === false || alert.clear === true;
    if (clearing) {
      pendingMevAlert = null;
      if (engine) engine.setMevAlert(null);
      window.dispatchEvent(new CustomEvent('nodecluster:mev-alert-update', { detail: { active: false } }));
      return false;
    }
    if (!isCredibleMevSignal(alert)) {
      window.dispatchEvent(new CustomEvent('nodecluster:mev-alert-update', {
        detail: { active: Boolean(engine?.mevAlert), rejected: true, reason: 'Requires a high-confidence, token-matched, pair-specific pending sandwich/front-run signal.' },
      }));
      return false;
    }
    pendingMevAlert = alert;
    const active = engine ? engine.setMevAlert(alert) : true;
    window.dispatchEvent(new CustomEvent('nodecluster:mev-alert-update', {
      detail: { active: Boolean(active), source: alert.source || alert.provider || null, type: alert.type || alert.kind || null, pairAddress: alert.pairAddress || alert.dexPairAddress || alert.poolAddress || alert.pair?.address || null },
    }));
    return Boolean(active);
  }

  function setLiquidationHeatmap(snapshot) {
    pendingLiquidationHeatmap = snapshot || null;
    if (engine) engine.setLiquidationHeatmap(snapshot);
    window.dispatchEvent(new CustomEvent('nodecluster:liquidation-update', { detail: snapshot || null }));
    return Boolean(snapshot);
  }

  function refreshLiquidationHeatmap(token = activeToken) {
    return requestLiquidationSnapshot(token);
  }

  function setLayers(layers) {
    activeLayers = { ...activeLayers, ...(layers || {}) };
    if (engine) engine.setLayers(activeLayers);
    syncLiquidationPolling();
    return { ...activeLayers };
  }

  function pushTransaction(transaction) {
    if (engine) return engine.pushTransaction(transaction || {});
    if (transaction) pendingTransactions.push(transaction);
    if (pendingTransactions.length > 48) pendingTransactions.shift();
    return false;
  }

  function getDataStatus() {
    return { ...fetchStatus };
  }

  function getState() {
    return engine ? engine.getState() : {
      version: VERSION,
      mounted: false,
      source: pendingData?.source || 'demo',
      token: activeToken,
      layers: { ...activeLayers },
      security: pendingData?.security || null,
      dataStatus: pendingData?.dataStatus || { ...fetchStatus },
      liquidationHeatmap: pendingLiquidationHeatmap || { status: activeLayers.liquidationHeatmap ? 'idle' : 'disabled', levels: [] },
      mevAlert: pendingMevAlert,
      flowEdges: [],
      holderCount: Array.isArray(pendingData?.holders) ? pendingData.holders.length : DEMO_HOLDERS.length + 1,
      holders: Array.isArray(pendingData?.holders) ? pendingData.holders : [],
    };
  }

  const api = {
    version: VERSION,
    mount,
    unmount,
    setData,
    setHolders,
    setLayers,
    pushTransaction,
    setMevAlert,
    setLiquidationHeatmap,
    refreshLiquidationHeatmap,
    fetchTokenData,
    refreshTokenData: (token = activeToken) => fetchTokenData(token, { force: true }),
    configure: configureFetcher,
    getDataStatus,
    getState,
    exportPng: async (options = {}) => engine ? engine.exportPng(options) : null,
  };
  window[RUNTIME_KEY] = api;
  window.NodeCluster = api;

  window.addEventListener('nodecluster:mount', (event) => mount(event.detail || {}));
  window.addEventListener('nodecluster:token-change', (event) => {
    if (event.detail?.token) setActiveToken(event.detail.token);
    if (activeToken && fetchConfig.autoFetch !== false) void fetchTokenData(activeToken);
  });
  window.addEventListener('nodecluster:refresh-data', () => {
    if (activeToken) void fetchTokenData(activeToken, { force: true });
  });
  window.addEventListener('nodecluster:mev-alert', (event) => setMevAlert(event.detail || null));
  window.addEventListener('nodecluster:liquidation-snapshot', (event) => setLiquidationHeatmap(event.detail || null));
  window.addEventListener('nodecluster:liquidation-refresh', () => { void refreshLiquidationHeatmap(); });
  window.addEventListener('nodecluster:layers-change', (event) => setLayers(event.detail?.layers || event.detail || {}));
  window.addEventListener('nodecluster:unmount', () => unmount());
  window.addEventListener('nodecluster:transaction', (event) => pushTransaction(event.detail || {}));
  window.addEventListener('nodecluster:holders', (event) => setData(event.detail || {}));

  window.dispatchEvent(new CustomEvent('nodecluster:runtime-ready', {
    detail: { version: VERSION, canvasId: 'nodecluster-canvas', api: 'window.NodeCluster' },
  }));
})();
