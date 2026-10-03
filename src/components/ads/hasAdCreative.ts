// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.

/**
 * Adsterra appends the creative into its placement container. Ignore the
 * delivery scripts and our own no-fill message so neither is mistaken for an
 * actual ad when polling or watching for a late fill.
 */
export function hasAdCreative(host: HTMLElement | null): boolean {
  if (!host) return false;
  if (host.querySelector('iframe, ins, img')) return true;

  return Array.from(host.children).some(
    (child) => !child.matches('script, [data-ad-fallback]'),
  );
}
