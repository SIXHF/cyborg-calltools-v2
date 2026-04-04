import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Match current calltools dark theme
        ct: {
          bg: '#0a0e17',
          surface: 'rgba(22, 27, 34, 0.75)',
          border: 'rgba(33, 38, 45, 0.6)',
          text: '#e0e6f0',
          muted: '#8b949e',
          accent: '#58a6ff',
          blue: '#1f6feb',
          green: '#3fb950',
          red: '#f85149',
          yellow: '#d29922',
        },
      },
      fontFamily: {
        sans: ['Segoe UI', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      backdropBlur: {
        glass: '12px',
      },
    },
  },
  plugins: [],
} satisfies Config;
