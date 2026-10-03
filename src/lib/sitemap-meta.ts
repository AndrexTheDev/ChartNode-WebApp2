// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
import type { MetadataRoute } from 'next';

/**
 * Pflege-Quelle für die Sitemap: echte Inhalts-Stände statt Build-Zeitstempel.
 * `lastmod` wird aktualisiert, wenn sich der sichtbare Inhalt einer Route
 * ändert – ein Build-Zeitstempel auf jeder URL wäre Crawl-Budget-Noise und
 * würde Suchmaschinen bei jedem Deploy sinnlose Re-Crawls signalisieren.
 */
export interface RouteSeo {
  path: string;
  priority: number;
  changeFrequency: NonNullable<MetadataRoute.Sitemap[number]['changeFrequency']>;
  /** ISO-Datum des letzten sichtbaren Inhaltsstandes (gepflegt). */
  lastmod: string;
}

export const ROUTE_SEO: RouteSeo[] = [
  // Landing: copy, access-model and metadata accuracy review.
  { path: '', priority: 1, changeFrequency: 'weekly', lastmod: '2026-10-02' },
  // Terminal: chart tools, data limitations and access descriptions updated.
  { path: '/terminal', priority: 0.9, changeFrequency: 'weekly', lastmod: '2026-10-02' },
  // Standalone NodeCluster holder-analysis tool.
  { path: '/cluster', priority: 0.75, changeFrequency: 'weekly', lastmod: '2026-10-02' },
  // Help: localized calculation notes and provider/access limitations.
  { path: '/help', priority: 0.8, changeFrequency: 'monthly', lastmod: '2026-10-02' },
  // Legal: access, privacy and data-limit copy reviewed.
  { path: '/legal/terms', priority: 0.2, changeFrequency: 'yearly', lastmod: '2026-10-02' },
  { path: '/legal/privacy', priority: 0.2, changeFrequency: 'yearly', lastmod: '2026-10-02' },
  { path: '/legal/disclaimer', priority: 0.2, changeFrequency: 'yearly', lastmod: '2026-10-02' },
];
