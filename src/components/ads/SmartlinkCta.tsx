// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
import type { ReactNode } from 'react';
import { NeonButton } from '@/components/ui/NeonButton';
import { SMARTLINKS_ENABLED, SMARTLINK_URL } from '@/lib/ads/smartlinks';

interface SmartlinkCtaProps {
  /** Button-Label (übersetzt vom Call-Site). */
  label: string;
  /** Disclosure-Text fürs Badge (ads.sponsored). */
  badge: string;
  leading?: ReactNode;
  size?: 'sm' | 'md';
}

/**
 * Server-gerenderter Smartlink-CTA: echter `<a href target="_blank"
 * rel="sponsored noopener">` – von Anfang an im HTML (SEO-konform als Paid
 * Link gekennzeichnet, blocker-resistent weil reine User-Geste-Navigation).
 * Das Kit ergänzt nur Tracking/Cap; das Badge ist bereits statisch, damit
 * vor dem Kit-CSS-Laden kein ungestylter Text blitzt (Tailwind-Basis).
 */
export function SmartlinkCta({ label, badge, leading, size = 'sm' }: SmartlinkCtaProps) {
  if (!SMARTLINKS_ENABLED) return null;
  return (
    <NeonButton
      href={SMARTLINK_URL}
      external
      target="_blank"
      rel="sponsored noopener"
      data-smartlink=""
      variant="outline"
      size={size}
      /* NeonButton-Basis ist `whitespace-nowrap`: die CTA war damit intrinsisch
         ~306 px breit. Auf 320-px-Geräten ist der Strip-Container aber nur
         288 px, sodass die CTA 20 px über den Rand lief und die Badge-Kante
         abgeschnitten wurde. `max-w-full` begrenzt die Box, das Label oben darf
         als einziges Element umbrechen – Badge und Höhe bleiben dadurch exakt
         wie auf dem Desktop. */
      className="max-w-full"
      leading={leading}
      trailing={
        <span className="nc-sl-badge ml-1 border border-primary/30 bg-primary/5 px-1 font-mono text-micro-8 uppercase tracking-cyber text-primary/80">
          {badge}
        </span>
      }
    >
      <span className="whitespace-normal [overflow-wrap:anywhere]">{label}</span>
    </NeonButton>
  );
}
