import type { Config } from 'tailwindcss';
import forms from '@tailwindcss/forms';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Brand accent — reserved for logo, focus rings, brand chrome.
        // NEVER used on YES/NO/BUY/SELL.
        brand: {
          DEFAULT: '#22d3ee', // cyan-400
          muted: '#0e7490',
        },
        // Trade polarity — the only colors used for price/position state.
        yes: {
          DEFAULT: '#4ade80', // green-400
          strong: '#22c55e', // green-500
          tint: 'rgba(34, 197, 94, 0.10)',
        },
        no: {
          DEFAULT: '#f87171', // red-400
          strong: '#ef4444', // red-500
          tint: 'rgba(239, 68, 68, 0.10)',
        },
        live: {
          DEFAULT: '#f59e0b', // amber-500
          tint: 'rgba(245, 158, 11, 0.15)',
        },
      },
      fontFamily: {
        sans: [
          'InterVariable',
          'Inter',
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'sans-serif',
        ],
        mono: [
          'JetBrains Mono',
          'ui-monospace',
          'SFMono-Regular',
          'Menlo',
          'Monaco',
          'monospace',
        ],
      },
      animation: {
        'price-flash-up': 'priceFlashUp 600ms ease-out',
        'price-flash-down': 'priceFlashDown 600ms ease-out',
        'pulse-live': 'pulseLive 1.6s ease-in-out infinite',
      },
      keyframes: {
        priceFlashUp: {
          '0%': { backgroundColor: 'rgba(34, 197, 94, 0.35)' },
          '100%': { backgroundColor: 'transparent' },
        },
        priceFlashDown: {
          '0%': { backgroundColor: 'rgba(239, 68, 68, 0.35)' },
          '100%': { backgroundColor: 'transparent' },
        },
        pulseLive: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.4' },
        },
      },
    },
  },
  plugins: [forms],
};

export default config;
