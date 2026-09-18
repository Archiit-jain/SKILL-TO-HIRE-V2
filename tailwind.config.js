/** @type {import('tailwindcss').Config} */

// Colours resolve to CSS variables defined in src/index.css, so one `dark` class on <html> swaps the whole palette.
const STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];
const tokens = (name) =>
  Object.fromEntries(STEPS.map((step) => [step, `rgb(var(--c-${name}-${step}) / <alpha-value>)`]));

// Fixed palettes: surfaces that stay dark in both themes (sidebar, hero preview, score card) and the accent on them.
const ink = {
  50: "#eef5ea", 100: "#d9e6d3", 200: "#b3c8aa", 300: "#8ba681", 400: "#6a8761",
  500: "#4f6a48", 600: "#3a5035", 700: "#2a3b27", 800: "#1c291a", 900: "#121c11", 950: "#0a110a",
};
const parrot = {
  50: "#f1fbe8", 100: "#def6c9", 200: "#bfee98", 300: "#97e05c", 400: "#74cf2f", 500: "#57b41a",
  600: "#438f12", 700: "#356d13", 800: "#2d5715", 900: "#274a16", 950: "#122907",
};

export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        white: "rgb(var(--c-white) / <alpha-value>)",
        slate: tokens("slate"),
        // The accent is parrot green now; the key stays `cyan` so existing accent classes keep working.
        cyan: tokens("cyan"),
        emerald: tokens("emerald"),
        amber: tokens("amber"),
        rose: tokens("rose"),
        sky: tokens("sky"),
        orange: tokens("orange"),
        ink,
        parrot,
      },
      fontFamily: {
        sans: ['"Plus Jakarta Sans Variable"', "ui-sans-serif", "system-ui", "Segoe UI", "Roboto", "sans-serif"],
        display: ['"Space Grotesk Variable"', "ui-sans-serif", "system-ui", "Segoe UI", "sans-serif"],
      },
      keyframes: {
        float: { "0%, 100%": { transform: "translateY(0)" }, "50%": { transform: "translateY(-10px)" } },
        drift: {
          "0%, 100%": { transform: "translate3d(0, 0, 0) scale(1)" },
          "50%": { transform: "translate3d(18px, -22px, 0) scale(1.08)" },
        },
        shimmer: { "0%": { backgroundPosition: "0% 50%" }, "100%": { backgroundPosition: "200% 50%" } },
        "pulse-dot": { "0%, 100%": { opacity: "1" }, "50%": { opacity: "0.25" } },
      },
      animation: {
        float: "float 6s ease-in-out infinite",
        "float-slow": "float 9s ease-in-out infinite",
        drift: "drift 18s ease-in-out infinite",
        shimmer: "shimmer 6s linear infinite",
        "pulse-dot": "pulse-dot 2s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
