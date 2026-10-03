// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
import type { MetadataRoute } from 'next';
import { SITE_NAME } from '@/lib/constants';
import { THEME_COLOR } from '@/lib/theme';

/** Web app manifest – makes "Add to home screen" render as a real app icon. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${SITE_NAME} – Decode the Market`,
    short_name: SITE_NAME,
    description: 'Browser-based crypto charts and research tools for selected CEX and DEX markets. Core access has no recurring subscription; ads may appear and some Pro features require verified support.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    background_color: THEME_COLOR.acid,
    theme_color: THEME_COLOR.acid,
    categories: ['finance', 'productivity'],
    icons: [
      { src: '/brand/nodechart-icon-192.webp', sizes: '192x192', type: 'image/webp', purpose: 'any' },
      { src: '/brand/nodechart-icon-512.webp', sizes: '512x512', type: 'image/webp', purpose: 'any' },
    ],
    shortcuts: [
      // Relativ zur scope – absolute Cross-Origin-URLs verwirft der Browser
      // ("property 'url' ignored, should be within scope of the manifest").
      { name: 'Terminal', url: '/en/terminal', description: 'Open the charting terminal' },
      { name: 'Help', url: '/en/help', description: 'Open the help center' },
    ],
  };
}
