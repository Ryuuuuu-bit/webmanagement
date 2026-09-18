import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-sarabun)", "system-ui", "sans-serif"],
      },
      colors: {
        brand: {
          DEFAULT: "#2F6F5E",
          ink: "#1B4438",
          soft: "#E3F0EC",
        },
        ok: { DEFAULT: "#2F7D5A", soft: "#E3F3E9" },
        warn: { DEFAULT: "#B5651D", soft: "#FBEEDD" },
        danger: { DEFAULT: "#B4423A", soft: "#FBE7E5" },
        info: { DEFAULT: "#3162A6", soft: "#E7EEF7" },
      },
    },
  },
  plugins: [],
};
export default config;
