'use client';

import { forwardRef } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline';
type Size = 'sm' | 'md' | 'lg';

const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-[var(--color-ink)] text-[var(--color-canvas)] hover:bg-white active:bg-[#d8dbe0] ' +
    'disabled:bg-[var(--color-hairline-strong)] disabled:text-[var(--color-ink-faint)]',
  secondary:
    'bg-[var(--color-raised)] text-[var(--color-ink)] border border-[var(--color-hairline-strong)] ' +
    'hover:bg-[#1d2127] hover:border-[#3a4049]',
  outline:
    'bg-transparent text-[var(--color-ink)] border border-[var(--color-hairline-strong)] ' +
    'hover:bg-[var(--color-raised)] hover:border-[#3a4049]',
  ghost: 'bg-transparent text-[var(--color-ink-muted)] hover:text-[var(--color-ink)] hover:bg-[var(--color-raised)]',
  danger:
    'bg-[color-mix(in_oklab,var(--color-critical)_16%,transparent)] text-[var(--color-critical)] ' +
    'border border-[color-mix(in_oklab,var(--color-critical)_40%,transparent)] ' +
    'hover:bg-[color-mix(in_oklab,var(--color-critical)_24%,transparent)]',
};

const SIZES: Record<Size, string> = {
  sm: 'h-8 px-3 text-[13px] gap-1.5 rounded-md',
  md: 'h-10 px-4 text-sm gap-2 rounded-lg',
  lg: 'h-12 px-6 text-[15px] gap-2 rounded-lg',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
  iconRight?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', loading, icon, iconRight, className, children, disabled, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex items-center justify-center font-medium whitespace-nowrap select-none',
        'transition-[background-color,border-color,color,transform] duration-150',
        'active:scale-[0.985] disabled:pointer-events-none disabled:opacity-60',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    >
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : icon}
      {children}
      {!loading && iconRight}
    </button>
  );
});
