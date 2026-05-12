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
        // Brand palette — premium, creator-focused
        brand: {
          50: '#f0f4ff',
          100: '#e0eaff',
          200: '#c2d5ff',
          300: '#93b4fd',
          400: '#6089fa',
          500: '#3b62f5',   // primary
          600: '#2444e8',
          700: '#1c33ce',
          800: '#1d2da6',
          900: '#1e2d82',
          950: '#141d54',
        },
        accent: {
          50: '#fdf4ff',
          100: '#fae8ff',
          200: '#f5d0fe',
          300: '#f0abfc',
          400: '#e879f9',
          500: '#d946ef',   // secondary accent
          600: '#c026d3',
          700: '#a21caf',
          800: '#86198f',
          900: '#701a75',
        },
        surface: {
          DEFAULT: '#0f1117',
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
