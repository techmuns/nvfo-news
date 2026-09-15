/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        // Body = Inter, headings = Plus Jakarta Sans (via the `font-display` class).
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        display: ['"Plus Jakarta Sans"', 'Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        soft: '0 1px 2px 0 rgb(15 23 42 / 0.04), 0 8px 24px -12px rgb(15 23 42 / 0.12)',
      },
    },
  },
  // Topic / mood / avatar colours are written as COMPLETE class strings in
  // src/lib/theme.ts (e.g. "bg-emerald-100 text-emerald-700 ring-emerald-200",
  // "from-indigo-500 to-purple-500"), so the JIT discovers them via content
  // scanning — no safelist needed.
  plugins: [],
};
