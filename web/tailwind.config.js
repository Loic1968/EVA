/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        eva: {
          dark: '#0f172a',
          panel: '#1e293b',
          accent: '#DC2626',
          muted: '#64748b',
        },
      },
    },
  },
  plugins: [],
};
