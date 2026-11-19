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
        // SeeCareer-inspired deep-purple palette.
        // brand.500 = primary CTA violet; brand.400 = light accent.
        brand: {
          50: '#f5f1ff',
          100: '#ece4ff',
          200: '#d9c9ff',
          300: '#c2a8ff',
          400: '#a68aff',   // accent — light violet
          500: '#7c4dff',   // primary — CTA violet
          600: '#6a3ce0',
          700: '#552fc0',
          800: '#3f1d80',
          900: '#2c1166',   // hard-shadow violet
          950: '#1a0b3d',
        },
        accent: {
          50: '#fff0f7',
          100: '#ffd9ec',
          200: '#ffb3d9',
          300: '#ff8ec5',
          400: '#ff7eb6',   // pink accent / focus
          500: '#f75d9e',
          600: '#e03d85',
          700: '#ba2f6c',
          800: '#932556',
          900: '#701d42',
        },
        surface: {
          DEFAULT: '#0d0919',
          // Legacy warm keys remapped to the deep-purple system so old
          // landing markup adopts the new palette without per-page edits.
          warm: '#0d0919',
          'warm-50': '#171028',
          'warm-100': '#221839',
          'warm-200': '#2a1d4d',
          'warm-border': '#4a3391',
          'warm-ink': '#f3eeff',
          'warm-muted': '#b9addb',
          // Signed-in surfaces — SeeCareer panels
          50: '#f3eeff',
          100: '#e6ddff',
          200: '#4a3391',
          card: '#171028',
          'card-2': '#221839',
          border: '#4a3391',
          hover: '#2a1d4d',
          soft: '#2a1d4d',
        },
        sc: {
          bg: '#0d0919',
          panel: '#171028',
          panel2: '#221839',
          border: '#4a3391',
          line: '#3a2a6e',
          dim: '#8d7fb8',
          hard: '#2c1166',
          text: '#f3eeff',
          muted: '#b9addb',
          primary: '#a68aff',
          cta: '#7c4dff',
          ok: '#4ade80',
          warn: '#fbbf24',
          danger: '#ff6b81',
          saved: '#ffd23f',
          cyan: '#3de0ff',
        },
      },
      fontFamily: {
        sans: ["'DotGothic16'", "'VT323'", 'ui-monospace', 'monospace'],
        mono: ["'VT323'", 'ui-monospace', 'monospace'],
        pixel: ["'DotGothic16'", "'VT323'", 'ui-monospace', 'monospace'],
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
        'gradient-brand': 'linear-gradient(135deg, #7c4dff 0%, #a68aff 55%, #ff7eb6 100%)',
        'gradient-card': 'linear-gradient(145deg, #171028 0%, #221839 100%)',
        'gradient-hero':
          'radial-gradient(ellipse 80% 80% at 50% -20%,rgba(124,77,255,0.22),rgba(13,9,25,0))',
        'bg-grid':
          'linear-gradient(rgba(139,92,246,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(139,92,246,0.1) 1px, transparent 1px)',
      },
      backgroundSize: {
        'grid': '28px 28px',
      },
    },
  },
  plugins: [],
};

export default config;
