import clsx from 'clsx';
import type { AnchorHTMLAttributes } from 'react';

type Props = AnchorHTMLAttributes<HTMLAnchorElement> & {
  variant?: 'primary' | 'secondary';
};

/** Large tap target, visible focus ring. Renders an anchor so it works with any router. */
export function Button({ variant = 'primary', className, ...props }: Props) {
  return (
    <a
      {...props}
      className={clsx(
        'inline-flex min-h-11 items-center justify-center rounded-full px-6 text-sm font-medium transition-colors',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
        variant === 'primary'
          ? 'bg-accent text-accent-ink hover:opacity-90'
          : 'border border-line bg-surface text-ink hover:bg-bg',
        className,
      )}
    />
  );
}
