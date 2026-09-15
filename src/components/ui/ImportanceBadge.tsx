import type { Importance } from '../../lib/types';
import { IMPORTANCE } from '../../lib/theme';

export function ImportanceBadge({ importance }: { importance: Importance }) {
  const meta = IMPORTANCE[importance];
  return (
    <span
      className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${meta.badge}`}
    >
      {meta.label}
    </span>
  );
}
