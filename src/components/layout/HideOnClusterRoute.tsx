// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
'use client';

import type { ReactNode } from 'react';
import { usePathname } from '@/i18n/navigation';
import { ROUTES } from '@/lib/constants';

/** Keep the standalone canvas free of the landing-page ad and footer chrome. */
export function HideOnClusterRoute({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return pathname === ROUTES.cluster ? null : children;
}
