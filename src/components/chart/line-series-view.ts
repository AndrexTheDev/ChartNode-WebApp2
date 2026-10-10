/* © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md. */
/**
 * Value-line custom series (lightweight-charts v5 `addCustomSeries`).
 *
 * A minimal, allocation-light series that paints a continuous polyline from
 * `{ time, value }` points. It exists so indicator overlays (anchored VWAP,
 * compare-% lines) live *inside* the canvas as first-class series instead of
 * absolute-positioned HTML overlays:
 *
 *   · they pan/zoom with the candles and keep their price-scale binding;
 *   · `chart.takeScreenshot()` captures them (DOM overlays never do);
 *   · the library's autoscale, conflation and last-value label all work,
 *     driven by `priceValueBuilder`.
 *
 * Colors are plain sRGB strings; v5 resolves them through the canvas 2D
 * context's native parser (sRGB → Display P3 on capable panels), so no manual
 * channel math happens here.
 */

import type { CanvasRenderingTarget2D } from 'fancy-canvas';
import {
  customSeriesDefaultOptions,
  type CustomData,
  type CustomSeriesOptions,
  type CustomSeriesWhitespaceData,
  type ICustomSeriesPaneRenderer,
  type ICustomSeriesPaneView,
  type PaneRendererCustomData,
  type PriceToCoordinateConverter,
  type Time,
} from 'lightweight-charts';

export interface ValuePoint extends CustomData<Time> {
  time: Time;
  value: number;
}

export interface ValueLineOptions extends CustomSeriesOptions {
  /** Stroke color (sRGB string). */
  color: string;
  lineWidth: 1 | 2 | 3 | 4;
  dashed: boolean;
}

export class ValueLineSeriesView implements ICustomSeriesPaneView<Time, ValuePoint, ValueLineOptions> {
  private bars: readonly { x: number; data: ValuePoint }[] = [];
  private options: ValueLineOptions = {
    ...customSeriesDefaultOptions,
    color: '#ffffff',
    lineWidth: 2,
    dashed: false,
  };

  private rendererInstance: ICustomSeriesPaneRenderer = {
    draw: (target: CanvasRenderingTarget2D, priceConverter: PriceToCoordinateConverter) => {
      this.paint(target, priceConverter);
    },
  };

  renderer(): ICustomSeriesPaneRenderer {
    return this.rendererInstance;
  }

  /** v5 pushes the full (conflated) bar list before every paint. */
  update(data: PaneRendererCustomData<Time, ValuePoint>, seriesOptions: ValueLineOptions): void {
    this.bars = data.bars.map((bar) => ({ x: bar.x, data: bar.originalData }));
    this.options = seriesOptions;
  }

  /** Autoscale + crosshair/price-line values: a single-value series. */
  priceValueBuilder(plotRow: ValuePoint): number[] {
    return [plotRow.value, plotRow.value, plotRow.value];
  }

  isWhitespace(data: ValuePoint | CustomSeriesWhitespaceData<Time>): data is CustomSeriesWhitespaceData<Time> {
    // Whitespace bars carry only `{ time }` – the data field is absent.
    return (data as ValuePoint).value === undefined;
  }

  defaultOptions(): ValueLineOptions {
    return {
      ...customSeriesDefaultOptions,
      color: '#ffffff',
      lineWidth: 2,
      dashed: false,
    };
  }

  /** Release data references when the series is removed from the chart. */
  destroy(): void {
    this.bars = [];
  }

  private paint(target: CanvasRenderingTarget2D, priceConverter: PriceToCoordinateConverter): void {
    if (this.bars.length === 0) return;
    target.useMediaCoordinateSpace((scope) => {
      const ctx = scope.context;
      ctx.save();
      ctx.strokeStyle = this.options.color;
      ctx.lineWidth = this.options.lineWidth;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      if (this.options.dashed) ctx.setLineDash([4, 4]);

      ctx.beginPath();
      let started = false;
      for (const bar of this.bars) {
        const y = priceConverter(bar.data.value);
        if (y == null || !Number.isFinite(y)) {
          started = false;
          continue;
        }
        if (started) ctx.lineTo(bar.x, y);
        else {
          ctx.moveTo(bar.x, y);
          started = true;
        }
      }
      ctx.stroke();
      ctx.restore();
    });
  }
}
