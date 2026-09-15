// Shared "glass" tooltip styling for Recharts. Dark, rounded, blurred.
import type { ReactNode } from 'react';

export interface RTooltipProps {
  active?: boolean;
  payload?: any[];
  label?: string | number;
}

export function GlassCard({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl bg-slate-900/90 px-3 py-2 text-xs text-white shadow-lg ring-1 ring-white/10 backdrop-blur">
      {children}
    </div>
  );
}

export function Swatch({ color }: { color: string }) {
  return (
    <span
      className="inline-block h-2.5 w-2.5 rounded-full"
      style={{ background: color }}
    />
  );
}
