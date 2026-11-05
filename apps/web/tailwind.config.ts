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
        // Brand palette — violet accent drawn from the Engganyo logo.
        // Mapped to the logo's violet so landing + shell read as one product.
        brand: {
          50: '#f4f0ff',
          100: '#ebe3ff',
          200: '#d7c7ff',
          300: '#b999ff',
          400: '#9663fa',
          500: '#7c3aed',   // primary — violet from the logo
          600: '#6d28d9',
          700: '#5b21b6',
          800: '#4c1d95',
          900: '#3b1674',
          950: '#25104d',
        },
        accent: {
          50: '#fdf4ff',
          100: '#fae8ff',
          200: '#f5d0fe',
          300: '#f0abfc',
          400: '#e879f9',
          500: '#d946ef',
          600: '#c026d3',
          700: '#a21caf',
          800: '#86198f',
          900: '#701a75',
        },
        surface: {
          DEFAULT: '#0f1117',
          // Public landing — warm off-white (deep ink stays the signed-in side)
          warm: '#faf9f7',
          'warm-50': '#f8f7f5',
          'warm-100': '#f1f0ed',
          'warm-200': '#e4e2dd',
          'warm-border': '#dedcd6',
          'warm-ink': '#1c1b1a',
          'warm-muted': '#57554f',
          // Signed-in surfaces — deep ink (unchanged family)
          50: '#f8f9fc',
          100: '#f1f3f7',
          200: '#e2e6ef',
          card: '#161b2e',
          border: '#1e2740',
          hover: '#1a2035',
        },
      },
      fontFamily: {
        sans: ['var(--font-inter)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'monospace'],
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
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
        'gradient-brand': 'linear-gradient(135deg, #3b62f5 0%, #d946ef 100%)',
        'gradient-card': 'linear-gradient(145deg, #161b2e 0%, #1a2035 100%)',
        'gradient-hero':
          'radial-gradient(ellipse 80% 80% at 50% -20%,rgba(59,98,245,0.3),rgba(255,255,255,0))',
      },
    },
  },
  plugins: [],
};

export default config;
