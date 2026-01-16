import { cn } from '@/lib/utils';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  children: ReactNode;
}

export function Button({ 
  variant = 'primary', 
  size = 'md', 
  className, 
  children, 
  ...props 
}: ButtonProps) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center font-medium rounded-lg transition-colors',
        'focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-[#0f0f10]',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        {
          'bg-emerald-600 text-white hover:bg-emerald-500 focus:ring-emerald-500': variant === 'primary',
          'bg-zinc-800 text-zinc-100 hover:bg-zinc-700 focus:ring-zinc-500': variant === 'secondary',
          'bg-transparent text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 focus:ring-zinc-500': variant === 'ghost',
        },
        {
          'px-3 py-1.5 text-sm': size === 'sm',
          'px-4 py-2 text-sm': size === 'md',
          'px-6 py-3 text-base': size === 'lg',
        },
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
}

