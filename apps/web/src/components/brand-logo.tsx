import { cn } from '@/lib/utils';

interface BrandLogoProps {
  /** Size classes for the square glyph, e.g. "h-8 w-8" or "h-9". */
  className?: string;
  /** Show the "Engganyo" pixel wordmark next to the glyph. */
  wordmark?: boolean;
  wordmarkClassName?: string;
  /** When false the glyph is decorative and the wordmark carries the alt text. */
  alt?: string;
  /** Explicit pixel size (width and height attributes) — required for
      layout stability, defaults to the common 32px header size. */
  size?: number;
  /** Eager + high-priority loading for the above-the-fold header glyph. */
  eager?: boolean;
}

/**
 * Official Engganyo brand mark — pixel glyph + wordmark.
 * Glyph: /brand/web-logo-transparent.svg (gold #E8A800 + blue #1F62F0 on transparent).
 */
export function BrandLogo({
  className = 'h-8 w-8',
  wordmark = true,
  wordmarkClassName = 'text-lg',
  alt = 'Engganyo',
  size = 32,
  eager = false,
}: BrandLogoProps) {
  return (
    <span className="inline-flex items-center gap-2 select-none">
      <img
        src="/brand/web-logo-transparent.svg"
        alt={wordmark ? '' : alt}
        width={size}
        height={size}
        loading={eager ? 'eager' : 'lazy'}
        fetchPriority={eager ? 'high' : 'auto'}
        decoding="async"
        className={cn('object-contain', className)}
        draggable={false}
      />
      {wordmark && (
        <span
          className={cn(
            'font-pixel font-bold tracking-wide text-sc-text leading-none',
            wordmarkClassName,
          )}
          aria-hidden="true"
        >
          Engganyo
        </span>
      )}
    </span>
  );
}
