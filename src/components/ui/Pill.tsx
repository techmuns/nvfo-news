import type { ReactNode } from 'react';

export function Pill({
  className = '',
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold leading-none ${className}`}
    >
      {children}
    </span>
  );
}
