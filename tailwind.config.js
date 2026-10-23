/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Space Grotesk"', '"Inter"', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      colors: {
        background: '#09090b',
        surface: '#121215',
        'surface-elevated': '#18181b',
        border: '#27272a',
        // stone + white come from CSS variables so dark mode only swaps the
        // variables (see index.css) instead of overriding every class.
        white: 'rgb(var(--c-white) / <alpha-value>)',
        stone: Object.fromEntries(
          ['50', '100', '200', '300', '400', '500', '600', '700', '800', '900', '950'].map((s) => [
            s,
            `rgb(var(--stone-${s}) / <alpha-value>)`,
          ])
        ),
        accent: 'rgb(var(--accent) / <alpha-value>)',
      },
      // Readability: one step larger than Tailwind's defaults (xs 12→13px, sm 14→15px)
      fontSize: {
        xs: ['0.8125rem', { lineHeight: '1.125rem' }],
        sm: ['0.9375rem', { lineHeight: '1.375rem' }],
      },
      // Tailwind v3 has no shadow-2xs / shadow-xs; the components use them
      boxShadow: {
        '2xs': '0 1px 0 0 rgb(0 0 0 / 0.04)',
        xs: '0 1px 2px 0 rgb(0 0 0 / 0.05)',
      },
      animation: {
        'fade-in': 'fadeIn 150ms cubic-bezier(0.16, 1, 0.3, 1)',
        'fade-out': 'fadeOut 150ms cubic-bezier(0.16, 1, 0.3, 1)',
        'scale-in': 'scaleIn 150ms cubic-bezier(0.16, 1, 0.3, 1)',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        fadeOut: {
          '0%': { opacity: '1' },
          '100%': { opacity: '0' },
        },
        scaleIn: {
          '0%': { opacity: '0', transform: 'scale(0.96)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
      },
    },
  },
  plugins: [],
};
