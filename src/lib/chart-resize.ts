/* © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md. */
/**
 * Frame-coalesced sizing for lightweight-charts v5 panes.
 *
 * Each chart pane owns exactly one `ResizeObserver`. The observer callback
 * never touches the chart directly: it schedules at most ONE
 * `chart.applyOptions({ width, height })` per animation frame (16 ms / 60 fps
 * boundary via `requestAnimationFrame`). Browser resize events, grid
 * reflows, toolbar folds and pane-count changes can fire dozens of
 * observations per frame – coalescing them means the canvas resizes exactly
 * once per painted frame, which eliminates the flicker a naive
 * "observe → applyOptions" loop produces (the library clears and repaints the
 * whole canvas on every applyOptions).
 *
 * Sizing is explicit (`autoSize: false` on the chart): the wrapper is the
 * single source of truth for the canvas geometry. The CSS-pixel size is
 * passed as integers; lightweight-charts (fancy-canvas) multiplies it by
 * `window.devicePixelRatio` internally, so Retina / high-DPI screens always
 * render 1:1 without any extra work here.
 */

export interface ChartResizeOptions {
  /** Never shrink the canvas below this (px). Default 50. */
  minWidth?: number;
  /** Never shrink the canvas below this (px). Default 50. */
  minHeight?: number;
}

export interface ChartSize {
  width: number;
  height: number;
}

/** Measures the element in CSS pixels, clamped to sane minima. */
export function measureChartSize(element: HTMLElement, options?: ChartResizeOptions): ChartSize {
  const rect = element.getBoundingClientRect();
  return {
    width: Math.max(options?.minWidth ?? 50, Math.round(rect.width)),
    height: Math.max(options?.minHeight ?? 50, Math.round(rect.height)),
  };
}

/**
 * Starts observing `element` and applies size changes to `chart` on the frame
 * boundary. Returns a disposer that disconnects the observer and cancels any
 * pending frame – call it when the chart is removed.
 */
export function observeChartSize(
  chart: { applyOptions: (options: ChartSize) => void },
  element: HTMLElement,
  options?: ChartResizeOptions,
): () => void {
  let raf: number | null = null;
  let last = { width: -1, height: -1 };

  const apply = () => {
    raf = null;
    const { width, height } = measureChartSize(element, options);
    // Same size as the last applied frame ⇒ the canvas is already correct;
    // skipping avoids a full canvas clear+repaint for zero visual change.
    if (width === last.width && height === last.height) return;
    last = { width, height };
    chart.applyOptions({ width, height });
  };

  const schedule = () => {
    if (raf !== null) return;
    raf = requestAnimationFrame(apply);
  };

  // First paint: the observer also fires on `observe()`, but measuring now
  // guarantees the very first frame is sized (no empty 50×50 flash).
  schedule();

  // Ancient browser without ResizeObserver: fall back to window resize events
  // (still coalesced through the same rAF boundary).
  if (typeof ResizeObserver === 'undefined') {
    window.addEventListener('resize', schedule);
    return () => {
      window.removeEventListener('resize', schedule);
      if (raf !== null) cancelAnimationFrame(raf);
    };
  }

  const observer = new ResizeObserver(schedule);
  observer.observe(element);

  return () => {
    observer.disconnect();
    if (raf !== null) cancelAnimationFrame(raf);
  };
}
