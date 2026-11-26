/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"IBM Plex Sans"', "-apple-system", "BlinkMacSystemFont", '"Trebuchet MS"', "sans-serif"],
        mono: ['"IBM Plex Mono"', "ui-monospace", "SFMono-Regular", "monospace"],
      },
      colors: {
        canvas: "#0F0F0F",
        surface: "#171717",
        elevated: "#1F1F1F",
        borderSubtle: "#2A2A2A",
        upstoxGreen: "#089981",
        upstoxRed: "#F23645",
        accentGold: "#F59E0B",
        textPrimary: "#E0E0E0",
        textMuted: "#8A8A8A",
      },
    },
  },
  plugins: [],
};
