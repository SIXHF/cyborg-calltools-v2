import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Exact V1 calltools dark theme
        ct: {
          bg: '#0a0e17',
          surface: 'rgba(22, 27, 34, 0.75)',
          'surface-solid': '#161b22',
          border: 'rgba(33, 38, 45, 0.6)',
          'border-solid': '#21262d',
          'border-hover': '#30363d',
          text: '#e0e6f0',
          'text-secondary': '#c9d1d9',
          muted: '#8b949e',
          'muted-dark': '#484f58',
          accent: '#58a6ff',
          blue: '#1f6feb',
          'blue-bright': '#388bfd',
          green: '#3fb950',
          'green-dark': '#238636',
          'green-bg': '#0d2818',
          red: '#f85149',
          'red-dark': '#da3633',
          'red-bg': '#2d1117',
          yellow: '#d29922',
          'yellow-bg': '#2d1b00',
          purple: '#d2a8ff',
          'purple-dark': '#8b5cf6',
          'purple-bg': '#1c1230',
        },
      },
      fontFamily: {
        sans: ['Segoe UI', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      backdropBlur: {
        glass: '12px',
      },
      animation: {
        'pulse-glow': 'pulseGlow 2s infinite',
        'fade-in': 'tabFadeIn 0.15s ease',
      },
      keyframes: {
        pulseGlow: {
          '0%, 100%': { opacity: '1', filter: 'drop-shadow(0 0 3px currentColor)' },
          '50%': { opacity: '0.6', filter: 'drop-shadow(0 0 1px currentColor)' },
        },
        tabFadeIn: {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
