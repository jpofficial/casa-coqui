/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",

        // === Casa Coqui Brand Palette ===

        // Primary: El Yunque Emerald — the deep green of the rainforest canopy
        // at midday when the light filters through and everything glows
        coqui: {
          50:  '#f0faf4',
          100: '#d1f2e0',
          200: '#a3e4c1',
          300: '#6dd09d',
          400: '#3ab878',
          500: '#1a9a5a',  // Primary action green
          600: '#137a47',  // The deep canopy — primary brand green
          700: '#0f5f38',
          800: '#0b4a2c',
          900: '#073620',
          950: '#042114',
        },

        // Secondary: Atardecer — the golden hour on Puerto Rico's west coast,
        // Rincon at sunset, the warmth that makes the whole sky amber
        atardecer: {
          50:  '#fefaf0',
          100: '#fdf0cc',
          200: '#fbe099',
          300: '#f8cb5c',
          400: '#f5b731',  // Warm gold accent
          500: '#e9a00e',
          600: '#cc7f0a',
          700: '#a85f0c',
          800: '#894c10',
          900: '#713e11',
          950: '#422006',
        },

        // Accent: Mar Caribe — the impossible turquoise of Flamenco Beach,
        // Crash Boat's reef water, the bioluminescent bays at night
        caribe: {
          50:  '#effcfc',
          100: '#d6f6f7',
          200: '#b2ecef',
          300: '#7ddde3',
          400: '#42c5cf',
          500: '#26a9b5',  // Caribbean blue accent
          600: '#228899',
          700: '#226e7c',
          800: '#245a66',
          900: '#224b57',
          950: '#11313b',
        },

        // Warm neutrals: Cafe con Leche — the creamy warmth of morning coffee,
        // the warm stone of Old San Juan buildings
        cafe: {
          50:  '#fdfbf7',
          100: '#f9f3e8',
          200: '#f2e4cc',
          300: '#e8d0a8',
          400: '#dbb67e',
          500: '#d09d5c',
          600: '#c28647',
          700: '#a26c3b',
          800: '#845736',
          900: '#6c482f',
          950: '#3a2518',
        },

        // Deep darks: Noche Tropical — the deep blue-green of a Puerto Rican
        // night, the jungle after dark, the deep end of a cenote
        noche: {
          50:  '#f0fdf6',
          100: '#dbfce8',
          200: '#baf5d3',
          300: '#84ebb2',
          400: '#47d889',
          500: '#1fbe68',
          600: '#139d52',
          700: '#137b44',
          800: '#156139',
          900: '#134f30',
          950: '#052e1a',  // Deep jungle dark — for backgrounds
        },

        // Flamboyan coral — the iconic red-orange of the flamboyan tree in bloom,
        // June in Puerto Rico when the whole island catches fire
        flamboyan: {
          50:  '#fff5f0',
          100: '#ffe8db',
          200: '#ffcdb6',
          300: '#ffa987',
          400: '#ff7a4d',
          500: '#ff5722',  // Flamboyan orange-red
          600: '#f03a08',
          700: '#c72c09',
          800: '#9e2610',
          900: '#802411',
          950: '#450f06',
        },
      },

      fontFamily: {
        // DM Sans — warm, modern, geometric but not cold.
        // The kind of font that feels like it was made for hospitality.
        sans: ['DM Sans', 'system-ui', '-apple-system', 'sans-serif'],
        // DM Serif Display — for the brand name and hero moments.
        // Elegant, warm serif that says "premium" without saying "colonial."
        display: ['DM Serif Display', 'Georgia', 'serif'],
      },

      borderRadius: {
        'brand': '1rem',       // 16px — the standard card radius
        'brand-lg': '1.25rem', // 20px — for larger containers
      },

      boxShadow: {
        'brand': '0 1px 3px 0 rgba(7, 54, 32, 0.08), 0 1px 2px -1px rgba(7, 54, 32, 0.08)',
        'brand-md': '0 4px 6px -1px rgba(7, 54, 32, 0.08), 0 2px 4px -2px rgba(7, 54, 32, 0.06)',
        'brand-lg': '0 10px 15px -3px rgba(7, 54, 32, 0.1), 0 4px 6px -4px rgba(7, 54, 32, 0.06)',
      },

      keyframes: {
        'slide-up': {
          '0%': { transform: 'translateY(100%)' },
          '100%': { transform: 'translateY(0)' },
        },
      },
      animation: {
        'slide-up': 'slide-up 0.25s ease-out',
      },
    },
  },
  plugins: [],
};
