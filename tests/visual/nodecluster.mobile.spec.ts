import { expect, test } from '@playwright/test';

const emptyPairs = { pairs: [] };

test('NodeCluster initializes, scales, accepts touch drag, and sustains mobile frame rate', async ({ page }, testInfo) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));

  // Keep the smoke deterministic and free: do not depend on live exchange/API
  // availability or any paid account. NodeCluster starts with its local demo snapshot.
  const offlineApiHosts = new Set([
    'data-api.binance.vision', 'api.binance.com', 'fapi.binance.com', 'api.bybit.com',
    'www.okx.com', 'api.kraken.com', 'api.exchange.coinbase.com', 'api.gateio.ws',
    'api-pub.bitfinex.com', 'api.huobi.pro', 'api.bitget.com', 'api.kucoin.com',
    'api.coinex.com', 'mempool.space', 'api.llama.fi', 'stablecoins.llama.fi',
    'api.gopluslabs.io', 'api.honeypot.is', 'api.rugcheck.xyz', 'api.geckoterminal.com',
    'api.dexscreener.com', 'api.coingecko.com', 'api.alternative.me', 'www.deribit.com',
    'solana-rpc.publicnode.com',
  ]);
  await page.route(/^https:\/\//, (route) => {
    const hostname = new URL(route.request().url()).hostname;
    if (!offlineApiHosts.has(hostname) && !hostname.endsWith('.blockscout.com')) return route.fallback();
    return route.fulfill({ json: {} });
  });
  await page.route('https://api.dexscreener.com/**', (route) => route.fulfill({ json: emptyPairs }));
  await page.route('https://api.gopluslabs.io/**', (route) => route.fulfill({ json: { code: 1, result: {} } }));
  await page.route('https://*.blockscout.com/**', (route) => route.fulfill({ json: {} }));
  await page.route('https://fapi.binance.com/**', (route) => route.fulfill({ json: {} }));
  await page.route('https://api.honeypot.is/**', (route) => route.fulfill({ json: {} }));
  // Keep all venue streams mocked too: the test has deterministic REST fixtures
  // and must not reconnect against public exchanges in a restricted CI network.
  await page.routeWebSocket(/^wss:\/\//, () => {});

  await page.goto('/en/terminal', { waitUntil: 'domcontentloaded' });
  // The warning is server-rendered and shown by a pre-paint CSS flag, so its
  // visibility does not prove React has hydrated. Exercise its client-side
  // control and assert the state change before testing the NodeCluster button.
  await expect(page.getByText('Touch screen detected')).toBeVisible();
  const forceEnable = page.getByRole('button', { name: 'Force enable' });
  await expect(forceEnable).toBeVisible();
  await forceEnable.click();
  await expect(forceEnable).toHaveAttribute('aria-pressed', 'true');

  const mobileToggle = page.getByTestId('nodecluster-toggle-mobile');
  await expect(mobileToggle).toBeVisible();
  await mobileToggle.click();
  await expect(mobileToggle).toHaveAttribute('aria-expanded', 'true');

  const canvas = page.locator('#nodecluster-canvas');
  await expect(canvas).toBeVisible();
  await page.waitForFunction(() => {
    const element = document.querySelector<HTMLCanvasElement>('#nodecluster-canvas');
    const api = (window as Window & { NodeCluster?: { getState?: () => { performance?: { renderedFrames?: number } } } }).NodeCluster;
    return Boolean(element && element.width > 0 && element.height > 0
      && api?.getState?.().performance?.renderedFrames && api.getState().performance!.renderedFrames! >= 8);
  });

  const initial = await canvas.evaluate((element) => {
    const node = element as HTMLCanvasElement;
    const rect = node.getBoundingClientRect();
    const win = window as Window & { NodeCluster?: { getState: () => { performance: { quality: string; estimatedRenderFps: number } } } };
    return {
      cssWidth: rect.width,
      cssHeight: rect.height,
      backingWidth: node.width,
      backingHeight: node.height,
      devicePixelRatio: window.devicePixelRatio,
      quality: node.dataset.nodeclusterQuality,
      renderedReady: node.dataset.nodeclusterReady === 'true',
      performance: win.NodeCluster?.getState().performance ?? null,
    };
  });
  expect(initial.cssWidth).toBeGreaterThan(100);
  expect(initial.cssHeight).toBeGreaterThan(100);
  expect(initial.renderedReady).toBe(true);
  expect(initial.quality).toMatch(/balanced|low/);
  const ratioX = initial.backingWidth / initial.cssWidth;
  const ratioY = initial.backingHeight / initial.cssHeight;
  // The low-power mobile tier deliberately drops to DPR 1; it is still a
  // correctly sized backing store and must never become smaller than CSS size.
  expect(ratioX).toBeGreaterThan(0.95);
  expect(ratioX).toBeLessThanOrEqual(initial.devicePixelRatio + 0.02);
  const expectedMobileDpr = Math.min(initial.devicePixelRatio, initial.quality === 'low' ? 1 : 1.45);
  expect(Math.abs(ratioX - expectedMobileDpr)).toBeLessThan(0.03);
  expect(Math.abs(ratioX - ratioY)).toBeLessThan(0.02);

  // Simulated Pointer Events use pointerType=touch, the same events delivered
  // by iOS Safari and Android Chrome for a finger drag.
  const drag = await canvas.evaluate((element) => {
    const node = element as HTMLCanvasElement;
    const rect = node.getBoundingClientRect();
    const points: Array<[number, number]> = [
      [0.5, 0.5], [0.35, 0.35], [0.65, 0.35], [0.35, 0.65], [0.65, 0.65],
      [0.25, 0.5], [0.75, 0.5], [0.5, 0.25], [0.5, 0.75],
    ];
    for (const [fx, fy] of points) {
      const x = rect.left + rect.width * fx;
      const y = rect.top + rect.height * fy;
      const down = new PointerEvent('pointerdown', {
        bubbles: true, cancelable: true, pointerId: 71, pointerType: 'touch', button: 0, clientX: x, clientY: y,
      });
      node.dispatchEvent(down);
      if (!down.defaultPrevented) {
        node.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 71, pointerType: 'touch', clientX: x, clientY: y }));
        continue;
      }
      const move = new PointerEvent('pointermove', {
        bubbles: true, cancelable: true, pointerId: 71, pointerType: 'touch', button: 0, clientX: x + 24, clientY: y + 18,
      });
      node.dispatchEvent(move);
      node.dispatchEvent(new PointerEvent('pointerup', {
        bubbles: true, pointerId: 71, pointerType: 'touch', button: 0, clientX: x + 24, clientY: y + 18,
      }));
      return { started: true, movePrevented: move.defaultPrevented };
    }
    return { started: false, movePrevented: false };
  });
  expect(drag.started, 'A touch pointer should capture a crystal shard').toBe(true);
  expect(drag.movePrevented, 'Touch drag should prevent page scrolling while moving a shard').toBe(true);

  // Prefer 45+ FPS, but accept the renderer's documented low-power policy on
  // constrained emulators: reduce quality/target to 30 FPS and keep at least 24.
  // The synthetic FPS tuner is separately checked at exact frame intervals.
  await expect.poll(async () => canvas.evaluate(() => {
    const win = window as Window & {
      NodeCluster?: {
        getState: () => {
          performance: {
            estimatedRenderFps: number;
            targetFps: number;
            quality: string;
            mobilePerformanceFloorApplied: boolean;
          };
        };
      };
    };
    const performance = win.NodeCluster?.getState().performance;
    if (!performance) return false;
    const normalFrameRate = performance.estimatedRenderFps > 45 && performance.targetFps >= 45;
    const lowPowerFallback = performance.mobilePerformanceFloorApplied
      && performance.quality === 'low' && performance.targetFps === 30
      && performance.estimatedRenderFps >= 24;
    return normalFrameRate || lowPowerFallback;
  }), { timeout: 12_000, intervals: [500, 750, 1000] }).toBe(true);

  // Verify ResizeObserver updates the DPR backing store after a mobile resize.
  const beforeResize = await canvas.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { width: rect.width, height: rect.height, backingWidth: (element as HTMLCanvasElement).width };
  });
  const viewport = page.viewportSize();
  if (viewport) await page.setViewportSize({ width: viewport.width - 24, height: viewport.height });
  await expect.poll(() => canvas.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const node = element as HTMLCanvasElement;
    const qualityCap = node.dataset.nodeclusterQuality === 'low' ? 1 : 1.45;
    return Math.abs(node.width - Math.round(rect.width * Math.min(window.devicePixelRatio, qualityCap)));
  })).toBeLessThanOrEqual(2);
  expect(beforeResize.height).toBeGreaterThan(100);

  expect(pageErrors, `${testInfo.project.name}: uncaught page errors`).toEqual([]);
  expect(consoleErrors, `${testInfo.project.name}: browser console errors`).toEqual([]);
});
