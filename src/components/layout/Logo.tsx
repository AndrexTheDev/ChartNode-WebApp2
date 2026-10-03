// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
import Image from 'next/image';
import { cn } from '@/lib/cn';

type LogoVariant = 'compact' | 'full';

interface LogoProps {
  className?: string;
  /** Header uses exact image crops; the footer can show the complete lockup. */
  variant?: LogoVariant;
  /** The header link already supplies its accessible name. */
  decorative?: boolean;
}

/**
 * Raster variants are resized/cropped directly from the supplied PNG; no logo
 * geometry or lettering is redrawn. See `public/brand/` for the derivatives.
 */
export function Logo({ className, variant = 'compact', decorative = false }: LogoProps) {
  if (variant === 'full') {
    return (
      <Image
        src="/brand/nodechart-logo.webp"
        width={768}
        height={768}
        alt={decorative ? '' : 'NodeChart — Crypto Analytics'}
        unoptimized
        loading="lazy"
        className={cn('h-auto w-36 max-w-full object-contain', className)}
      />
    );
  }

  return (
    <span className={cn('inline-flex shrink-0 items-center gap-2', className)}>
      <Image
        src="/brand/nodechart-mark.webp"
        width={512}
        height={512}
        alt=""
        aria-hidden="true"
        unoptimized
        loading="eager"
        className="size-8 shrink-0 object-contain"
      />
      <Image
        src="/brand/nodechart-wordmark.webp"
        width={900}
        height={203}
        alt={decorative ? '' : 'NodeChart — Crypto Analytics'}
        unoptimized
        loading="eager"
        className="h-auto w-[7.5rem] object-contain sm:w-[8.5rem]"
      />
    </span>
  );
}
