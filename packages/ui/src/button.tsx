import clsx from 'clsx';
import type { AnchorHTMLAttributes } from 'react';

type Variant = 'primary' | 'secondary';

/**
 * Button styling as a function, so an app can put it on its router's link component
 * (e.g. next/link) and keep client-side navigation. Large tap target, visible focus ring.
 */
export function buttonClasses({
  variant = 'primary',
  className,
}: { variant?: Variant; className?: string } = {}) {
  return clsx(
    'inline-flex min-h-11 items-center justify-center rounded-full px-6 text-sm font-medium transition-colors',
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
    variant === 'primary'
      ? 'bg-accent text-accent-ink hover:opacity-90'
      : 'border border-line bg-surface text-ink hover:bg-bg',
    className,
  );
}

type Props = AnchorHTMLAttributes<HTMLAnchorElement> & { variant?: Variant };

/** Renders a plain anchor, so it works with any router. */
export function Button({ variant = 'primary', className, ...props }: Props) {
  return <a {...props} className={buttonClasses({ variant, className })} />;
}
