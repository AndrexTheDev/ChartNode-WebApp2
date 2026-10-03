// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
'use client';

import { useTranslations } from 'next-intl';
import { cn } from '@/lib/cn';

/** Honest, localized no-fill notice that occupies the reserved ad geometry. */
export function AdUnavailable({ className }: { className?: string }) {
  const t = useTranslations('ads');

  return (
    <div
      data-ad-fallback=""
      role="status"
      aria-live="polite"
      className={cn(
        'flex h-full w-full min-h-0 items-center justify-center border border-dashed border-line/70 bg-surface/20 p-3 text-center font-mono text-micro-10 uppercase tracking-cyber text-fg',
        className,
      )}
    >
      <span>{t('unavailable')}</span>
    </div>
  );
}
