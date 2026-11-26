/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', "system-ui", "-apple-system", "sans-serif"],
        mono: ['"JetBrains Mono"', "ui-monospace", "SFMono-Regular", "monospace"],
      },
      colors: {
        canvas: "#0B0E14",
        surface: "#121721",
        elevated: "#181E2B",
        borderSubtle: "#232B3A",
        upstoxGreen: "#00D09C",
        upstoxRed: "#EB5B3C",
        accentGold: "#F59E0B",
        textPrimary: "#F3F5F8",
        textMuted: "#8A94A6",
      },
    },
  },
  plugins: [],
};

