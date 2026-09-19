import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-sarabun)", "system-ui", "sans-serif"],
      },
      colors: {
        // Semantic, theme-aware tokens — their actual color comes from CSS
        // variables defined in globals.css (:root for light, .dark for
        // dark), so a single class name like `bg-surface` or `text-muted`
        // automatically flips when the `dark` class is toggled on <html>.
        page: "var(--color-page)",
        surface: "var(--color-surface)",
        ink: "var(--color-text)",
        line: {
          DEFAULT: "var(--color-line)",
          soft: "var(--color-line-soft)",
          strong: "var(--color-line-strong)",
        },
        muted: "var(--color-muted)",
        faint: "var(--color-faint)",
        subtle: "var(--color-subtle)",
        brand: {
          DEFAULT: "var(--color-brand)",
          ink: "var(--color-brand-ink)",
          soft: "var(--color-brand-soft)",
        },
        ok: { DEFAULT: "var(--color-ok)", soft: "var(--color-ok-soft)" },
        warn: { DEFAULT: "var(--color-warn)", soft: "var(--color-warn-soft)" },
        danger: { DEFAULT: "var(--color-danger)", soft: "var(--color-danger-soft)" },
        info: { DEFAULT: "var(--color-info)", soft: "var(--color-info-soft)" },
      },
    },
  },
  plugins: [],
};
export default config;
