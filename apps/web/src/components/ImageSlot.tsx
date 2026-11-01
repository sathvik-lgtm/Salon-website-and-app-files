import clsx from 'clsx';
import Image from 'next/image';
import { brand } from '@salon/config/brand';

/**
 * A photo slot with a fixed aspect ratio (so nothing shifts while it loads). With `src` (an R2 or
 * other URL) it shows the photo lazily; without one it shows a quiet placeholder until real photos
 * exist. Images are served as-is (`unoptimized`): there is no image optimiser on the free Workers
 * plan, so upload photos already sized (about 1600px wide, WebP/JPEG).
 */
export function ImageSlot({
  src,
  alt,
  ratio = 'aspect-[4/3]',
  sizes = '(min-width: 1024px) 33vw, 100vw',
  priority = false,
  className,
}: {
  src?: string | null;
  /** Describe the photo. Placeholders are decorative and ignore it. */
  alt: string;
  /** A Tailwind aspect-ratio class. */
  ratio?: string;
  sizes?: string;
  priority?: boolean;
  className?: string;
}) {
  return (
    <div className={clsx('relative overflow-hidden rounded-card bg-accent-soft', ratio, className)}>
      {src ? (
        <Image
          src={src}
          alt={alt}
          fill
          sizes={sizes}
          priority={priority}
          unoptimized
          className="object-cover"
        />
      ) : (
        <div
          aria-hidden="true"
          className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-accent-soft to-line"
        >
          <span className="font-display text-6xl text-accent/30 select-none">
            {brand.name.charAt(0)}
          </span>
        </div>
      )}
    </div>
  );
}
