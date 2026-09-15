import type { ReactNode } from 'react';

export function ChartCard({
  title,
  caption,
  children,
  className = '',
}: {
  title: string;
  caption: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`flex flex-col rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200/70 ${className}`}
    >
      <div className="mb-3">
        <h3 className="text-sm font-bold text-slate-800">{title}</h3>
        <p className="text-xs text-slate-500">{caption}</p>
      </div>
      <div className="flex-1">{children}</div>
    </div>
  );
}
