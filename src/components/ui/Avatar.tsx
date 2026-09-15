import { avatarGradient, monogram } from '../../lib/theme';

// Gradient company monogram avatar. Deterministic gradient per company name.
export function Avatar({ name, size = 40 }: { name: string; size?: number }) {
  return (
    <div
      className={`flex shrink-0 select-none items-center justify-center rounded-xl bg-gradient-to-br ${avatarGradient(
        name,
      )} font-display font-extrabold uppercase text-white shadow-sm ring-1 ring-white/40`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.34) }}
      aria-hidden="true"
    >
      {monogram(name)}
    </div>
  );
}
