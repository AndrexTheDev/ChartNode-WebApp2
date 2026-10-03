// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
import type { SearchHit } from '@/api/types';
import { CEX_UNIVERSE, cexToToken } from '@/lib/cex-universe';
import type { ExchangeId } from '@/websockets/types';
import type { Token } from '@/store/types';

/** Turn a shared SmartSearch result into the app's common token shape. */
export function searchHitToToken(hit: SearchHit, preferredExchange?: ExchangeId): Token | null {
  if (hit.kind === 'cex') {
    const instrument = CEX_UNIVERSE.find((entry) => `${entry.base}/${entry.quote}` === hit.symbol);
    if (!instrument) return null;
    const exchange = preferredExchange && instrument.exchanges.includes(preferredExchange)
      ? preferredExchange
      : instrument.exchanges[0] ?? 'binance';
    return cexToToken(instrument, exchange);
  }

  const { pair } = hit;
  return {
    id: `dex:${pair.chain}:${pair.baseAddress.toLowerCase()}`,
    symbol: `${pair.baseSymbol}/${pair.quoteSymbol}`,
    base: pair.baseSymbol,
    quote: pair.quoteSymbol,
    venue: 'DEX',
    chain: pair.chain,
    contract: pair.baseAddress,
  };
}
