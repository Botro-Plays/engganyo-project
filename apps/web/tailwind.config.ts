import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: ['class'],
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // Navy/blue/gold palette coordinated with the official badge logo
        // (#050918 / #121C38 / #2E4A8C / #1F62F0 / #E8A800).
        // brand.500 = primary action blue; brand.300/400 = light accent blues.
        brand: {
          50: '#f0f5ff',
          100: '#dce7ff',
          200: '#b9ceff',
          300: '#8fb0ff',   // light accent — icons/links on navy
          400: '#6e96ff',
          500: '#1f62f0',   // primary — brand blue actions
          600: '#1a54d6',
          700: '#1744ae',
          800: '#123a8c',
          900: '#0e2c6e',
          950: '#0a1e4d',
        },
        accent: {
          // Gold highlight ramp (logo gold #E8A800)
          50: '#fdf6e3',
          100: '#f9e7b8',
          200: '#f3d182',
          300: '#eec64e',
          400: '#f0b429',
          500: '#e8a800',   // gold highlight
          600: '#c98a00',
          700: '#a06e00',
          800: '#7d5600',
          900: '#664700',
        },
        surface: {
          DEFAULT: '#050918',
          // Legacy warm keys remapped to the navy system so old
          // landing markup adopts the new palette without per-page edits.
          warm: '#050918',
          'warm-50': '#121c38',
          'warm-100': '#1b2650',
          'warm-200': '#243257',
          'warm-border': '#2e4a8c',
          'warm-ink': '#f2f5ff',
          'warm-muted': '#a9b6d8',
          // Signed-in surfaces — navy panels
          50: '#f2f5ff',
          100: '#dde6fb',
          200: '#2e4a8c',
          card: '#121c38',
          'card-2': '#1b2650',
          border: '#2e4a8c',
          hover: '#243257',
          soft: '#243257',
        },
        sc: {
          bg: '#050918',
          panel: '#121c38',
          panel2: '#1b2650',
          border: '#2e4a8c',
          line: '#27407a',
          dim: '#8492b8',
          hard: '#0a0e1f',
          text: '#f2f5ff',
          muted: '#a9b6d8',
          primary: '#8fb0ff',
          cta: '#1f62f0',
          ok: '#4ade80',
          warn: '#fbbf24',
          danger: '#ff6b81',
          saved: '#e8a800',
          cyan: '#3de0ff',
        },
      },
      fontFamily: {
        sans: ['var(--font-dotgothic)', 'var(--font-vt323)', 'ui-monospace', 'monospace'],
        mono: ['var(--font-vt323)', 'ui-monospace', 'monospace'],
        pixel: ['var(--font-dotgothic)', 'var(--font-vt323)', 'ui-monospace', 'monospace'],
      },
      borderRadius: {
        // Square pixel panels — SeeCareer uses radius 0 with 2px borders
        none: '0px',
        sm: '0px',
        DEFAULT: '0px',
        md: '0px',
        lg: '0px',
        xl: '0px',
        '2xl': '0px',
        '3xl': '0px',
        full: '9999px',
      },
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
        'fade-in': {
          from: { opacity: '0', transform: 'translateY(4px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'slide-in-right': {
          from: { transform: 'translateX(100%)' },
          to: { transform: 'translateX(0)' },
        },
        shimmer: {
          from: { backgroundPosition: '-200px 0' },
          to: { backgroundPosition: 'calc(200px + 100%) 0' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
        'fade-in': 'fade-in 0.3s ease-out',
        'slide-in-right': 'slide-in-right 0.3s ease-out',
        shimmer: 'shimmer 1.5s infinite',
      },
      backgroundImage: {
        'gradient-brand': 'linear-gradient(135deg, #1f62f0 0%, #8fb0ff 55%, #e8a800 100%)',
        'gradient-card': 'linear-gradient(145deg, #121c38 0%, #1b2650 100%)',
        'gradient-hero':
          'radial-gradient(ellipse 80% 80% at 50% -20%,rgba(31,98,240,0.22),rgba(5,9,24,0))',
        'bg-grid':
          'linear-gradient(rgba(96,140,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(96,140,255,0.1) 1px, transparent 1px)',
      },
      backgroundSize: {
        'grid': '28px 28px',
      },
    },
  },
  plugins: [],
};

export default config;
