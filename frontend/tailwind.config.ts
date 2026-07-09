import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Semantic surface scale (darkest → most elevated)
        surface: {
          DEFAULT: "var(--surface-base)",
          sunken: "var(--surface-sunken)",
          input: "var(--surface-input)",
          raised: "var(--surface-raised)",
          hover: "var(--surface-hover)",
        },
        edge: {
          DEFAULT: "var(--edge)",
          strong: "var(--edge-strong)",
        },
        ink: {
          DEFAULT: "var(--ink)",
          dim: "var(--ink-dim)",
          mute: "var(--ink-mute)",
        },
        accent: {
          DEFAULT: "var(--accent)",
          hover: "var(--accent-hover)",
          deep: "var(--accent-deep)",
        },
        "on-accent": "var(--on-accent)",
        live: "var(--live)",
        ok: "var(--ok)",
        warn: "var(--warn)",
        danger: "var(--danger)",
      },
    },
  },
  plugins: [],
};
export default config;
