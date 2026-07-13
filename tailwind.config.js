/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // Paleta corporativa Empaques Belén (tomada de la invitación oficial)
        belen: {
          blue: '#1B3B8B',
          'blue-dark': '#132a63',
          'blue-light': '#2f52ad',
          orange: '#F26A21',
          'orange-dark': '#d9560f',
          'orange-light': '#ff8a4c',
          cream: '#FBF9F6',
          ink: '#101828',
        },
      },
      fontFamily: {
        sans: ['Poppins', 'Segoe UI', 'system-ui', 'sans-serif'],
        display: ['Poppins', 'Segoe UI', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        card: '0 4px 24px -4px rgba(27, 59, 139, 0.12)',
        'card-hover': '0 12px 40px -8px rgba(27, 59, 139, 0.25)',
      },
    },
  },
  plugins: [],
}
