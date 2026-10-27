/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ivory: { DEFAULT: '#F8F6F0', 200: '#EFEBE0', 300: '#E4DFD1' },
        forest: { DEFAULT: '#173D32', 700: '#123128', 800: '#0E2620', 900: '#0A1C17', 400: '#2E6152', 300: '#4D7F6F' },
        sage: { DEFAULT: '#B7CDB5', 100: '#E6EEE5', 200: '#D3E1D1', 600: '#7FA07C' },
        coral: { DEFAULT: '#EAA58D', 100: '#FAE8E1', 600: '#C9694B', 700: '#A9533A' },
        charcoal: { DEFAULT: '#252925', 600: '#4A504A', 500: '#636963', 400: '#8A908A' },
      },
      fontFamily: {
        display: ['Fraunces', 'Georgia', 'serif'],
        sans: ['Manrope', 'system-ui', 'Segoe UI', 'sans-serif'],
      },
      boxShadow: {
        soft: '0 1px 2px rgba(23,61,50,.06), 0 8px 24px -8px rgba(23,61,50,.14)',
        lift: '0 2px 4px rgba(23,61,50,.06), 0 24px 48px -16px rgba(23,61,50,.28)',
      },
      borderRadius: { '4xl': '2rem' },
    },
  },
  plugins: [],
}
