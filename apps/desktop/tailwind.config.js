/** Colors resolve to CSS variables set from @monk/design-system at runtime. */
const v = (name) => `var(--${name})`;

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: ['class'],
  theme: {
    extend: {
      colors: {
        bg: v('bg'),
        surface: { DEFAULT: v('surface'), 2: v('surface-2'), 3: v('surface-3') },
        line: { DEFAULT: v('border'), strong: v('border-strong') },
        ink: { DEFAULT: v('text'), muted: v('muted'), faint: v('faint') },
        accent: { DEFAULT: v('accent'), soft: v('accent-soft'), contrast: v('accent-contrast') },
        danger: v('danger'),
        success: v('success'),
        warning: v('warning'),
      },
      fontFamily: {
        sans: ['var(--font-sans)'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      borderRadius: { xl: '14px', '2xl': '18px' },
      boxShadow: {
        pop: '0 10px 40px -10px rgba(0,0,0,0.45), 0 0 0 1px var(--border)',
      },
      keyframes: {
        'fade-in': { from: { opacity: '0', transform: 'translateY(4px)' }, to: { opacity: '1', transform: 'none' } },
      },
      animation: { 'fade-in': 'fade-in 180ms ease-out' },
    },
  },
  plugins: [],
};
