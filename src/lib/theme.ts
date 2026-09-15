// Colour tokens + topic / mood styling. Full Tailwind class strings are composed
// here (not built dynamically) so the JIT compiler reliably picks them up.

import type { Topic, Mood, Importance } from './types';

export const BRAND = {
  indigo: '#6366f1',
  purple: '#a855f7',
  pink: '#ec4899',
};

// indigo -> purple -> pink, used on the logo tile and key accents.
export const BRAND_GRADIENT =
  'linear-gradient(135deg, #6366f1 0%, #a855f7 50%, #ec4899 100%)';

export interface TopicStyle {
  label: string;
  hex: string; // for Recharts fills
  pill: string; // full pill classes (bg + text + ring)
  text: string;
  dot: string; // bg-* for a coloured dot
  softBg: string; // light background for accents
  chipRing: string;
}

export const TOPIC_ORDER: Topic[] = [
  'Growth',
  'Orders',
  'Deals',
  'Money',
  'Approvals&IP',
  'Trouble',
  'Other',
];

export const TOPIC: Record<Topic, TopicStyle> = {
  Growth: {
    label: 'Growth',
    hex: '#10b981',
    pill: 'bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200',
    text: 'text-emerald-700',
    dot: 'bg-emerald-500',
    softBg: 'bg-emerald-50',
    chipRing: 'ring-emerald-200',
  },
  Orders: {
    label: 'Orders',
    hex: '#3b82f6',
    pill: 'bg-blue-100 text-blue-700 ring-1 ring-blue-200',
    text: 'text-blue-700',
    dot: 'bg-blue-500',
    softBg: 'bg-blue-50',
    chipRing: 'ring-blue-200',
  },
  Deals: {
    label: 'Deals',
    hex: '#8b5cf6',
    pill: 'bg-violet-100 text-violet-700 ring-1 ring-violet-200',
    text: 'text-violet-700',
    dot: 'bg-violet-500',
    softBg: 'bg-violet-50',
    chipRing: 'ring-violet-200',
  },
  Money: {
    label: 'Money',
    hex: '#f59e0b',
    pill: 'bg-amber-100 text-amber-700 ring-1 ring-amber-200',
    text: 'text-amber-700',
    dot: 'bg-amber-500',
    softBg: 'bg-amber-50',
    chipRing: 'ring-amber-200',
  },
  'Approvals&IP': {
    label: 'Approvals & IP',
    hex: '#14b8a6',
    pill: 'bg-teal-100 text-teal-700 ring-1 ring-teal-200',
    text: 'text-teal-700',
    dot: 'bg-teal-500',
    softBg: 'bg-teal-50',
    chipRing: 'ring-teal-200',
  },
  Trouble: {
    label: 'Trouble',
    hex: '#f43f5e',
    pill: 'bg-rose-100 text-rose-700 ring-1 ring-rose-200',
    text: 'text-rose-700',
    dot: 'bg-rose-500',
    softBg: 'bg-rose-50',
    chipRing: 'ring-rose-200',
  },
  Other: {
    label: 'Other',
    hex: '#64748b',
    pill: 'bg-slate-100 text-slate-600 ring-1 ring-slate-200',
    text: 'text-slate-600',
    dot: 'bg-slate-400',
    softBg: 'bg-slate-50',
    chipRing: 'ring-slate-200',
  },
};

export const MOOD_ORDER: Mood[] = ['positive', 'neutral', 'negative'];

export const MOOD: Record<
  Mood,
  { label: string; hex: string; dot: string; text: string; pill: string }
> = {
  positive: {
    label: 'Good',
    hex: '#10b981',
    dot: 'bg-emerald-500',
    text: 'text-emerald-600',
    pill: 'bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200',
  },
  neutral: {
    label: 'Neutral',
    hex: '#94a3b8',
    dot: 'bg-slate-400',
    text: 'text-slate-500',
    pill: 'bg-slate-100 text-slate-600 ring-1 ring-slate-200',
  },
  negative: {
    label: 'Bad',
    hex: '#f43f5e',
    dot: 'bg-rose-500',
    text: 'text-rose-600',
    pill: 'bg-rose-100 text-rose-700 ring-1 ring-rose-200',
  },
};

export const IMPORTANCE: Record<
  Importance,
  { label: string; badge: string }
> = {
  high: { label: 'High', badge: 'bg-slate-900 text-white' },
  medium: { label: 'Med', badge: 'bg-slate-200 text-slate-700' },
  low: { label: 'Low', badge: 'bg-slate-100 text-slate-400' },
};

// Palette for the "Most in the news" bars (cycled per company).
export const CHART_PALETTE = [
  '#6366f1',
  '#a855f7',
  '#ec4899',
  '#3b82f6',
  '#10b981',
  '#f59e0b',
  '#14b8a6',
  '#f43f5e',
];

// Gradient presets for company monogram avatars (deterministic pick by name).
export const AVATAR_GRADIENTS = [
  'from-indigo-500 to-purple-500',
  'from-purple-500 to-pink-500',
  'from-sky-500 to-indigo-500',
  'from-emerald-500 to-teal-500',
  'from-amber-500 to-orange-500',
  'from-rose-500 to-pink-500',
  'from-blue-500 to-cyan-500',
  'from-violet-500 to-fuchsia-500',
];

export function avatarGradient(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_GRADIENTS[h % AVATAR_GRADIENTS.length];
}

export function monogram(name: string): string {
  const words = name
    .replace(/[^A-Za-z0-9 ]/g, '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}
