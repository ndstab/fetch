/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          950: '#07070a',
          900: '#0b0b0f',
          800: '#14141a',
          700: '#1f1f28',
          600: '#2a2a36',
          500: '#3a3a4a',
          400: '#6e6e84',
          300: '#9a9ab0',
          200: '#c8c8d6',
          100: '#eaeaf2',
        },
        lime: {
          DEFAULT: '#c7ff3a',
          soft: '#dcff7a',
          dim: '#7e9e20',
        },
        flame: '#ff7849',
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
        display: ['"Space Grotesk"', 'Inter', 'sans-serif'],
      },
      animation: {
        'pulse-soft': 'pulseSoft 2.2s ease-in-out infinite',
        'shimmer': 'shimmer 2.2s linear infinite',
        'fade-up': 'fadeUp 0.5s ease-out both',
        'blink': 'blink 1s steps(2, start) infinite',
      },
      keyframes: {
        pulseSoft: {
          '0%, 100%': { opacity: '1', transform: 'scale(1)' },
          '50%': { opacity: '0.7', transform: 'scale(0.95)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        fadeUp: {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        blink: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0' },
        },
      },
      boxShadow: {
        'lime-glow': '0 0 0 1px rgba(199, 255, 58, 0.3), 0 8px 24px -8px rgba(199, 255, 58, 0.3)',
      },
    },
  },
  plugins: [],
};
