import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}', './sidepanel.html'],
  theme: {
    extend: {
      fontFamily: {
        display: ['Instrument Serif', 'serif'],
        sans: ['Inter', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      colors: {
        brand: {
          bg: 'var(--color-bg)',
          text: 'var(--color-text)',
          'text-2': 'var(--color-text-2)',
          'text-3': 'var(--color-text-3)',
          border: 'var(--color-border)',
          'border-strong': 'var(--color-border-strong)',
          accent: 'var(--color-accent)',
          'accent-bright': 'var(--color-accent-bright)',
          'accent-deep': 'var(--color-accent-deep)',
          'on-accent': 'var(--color-on-accent)',
          green: 'var(--color-green)',
          amber: 'var(--color-amber)',
          red: 'var(--color-red)',
          surface: 'var(--color-surface)',
          'surface-2': 'var(--color-surface-2)',
          'surface-3': 'var(--color-surface-3)',
          glow: 'var(--color-glow)',
        },
      },
      borderRadius: {
        sm: '6px',
        md: '8px',
        lg: '12px',
      },
      animation: {
        'fade-in': 'fadeIn 200ms ease-out',
        'slide-up': 'slideUp 200ms ease-out',
        'pulse-gentle': 'pulseGentle 2s ease-in-out infinite',
      },
      keyframes: {
        fadeIn: {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        slideUp: {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        pulseGentle: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.7' },
        },
      },
    },
  },
  plugins: [],
};

export default config;
