// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
import { notFound } from 'next/navigation';

/**
 * Catch unknown nested URLs inside a supported locale before Next falls back to
 * the root-level not-found boundary (the app intentionally has no app/layout).
 * Keeping the 404 in the locale subtree lets its localized not-found UI render
 * instead of turning an unknown URL such as /en/xx/terminal into a server 500.
 */
export default function UnknownLocaleRoute(): never {
  notFound();
}
