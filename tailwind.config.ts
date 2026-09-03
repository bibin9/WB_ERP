import type { Config } from "tailwindcss";

/**
 * White & Bright Group ERP — brand theme
 * Colours sourced from https://wandb.ae and the WB logo.
 *   navy   #023E71  primary (logo dark, nav, headers)
 *   blue   #29ABE2  bright accent (logo "B", links, highlights)
 *   green  #61B15A  action / success (site CTA button)
 *   gold   #E0A300  warning / accent
 *   paper  #FAFCFA  off-white background
 */
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Themeable via CSS variables (set per tenant at runtime — see src/config/tenant.ts)
        brand: {
          navy: "rgb(var(--brand-navy) / <alpha-value>)",
          "navy-700": "rgb(var(--brand-navy-700) / <alpha-value>)",
          "navy-900": "rgb(var(--brand-navy-900) / <alpha-value>)",
          blue: "rgb(var(--brand-blue) / <alpha-value>)",
          "blue-600": "rgb(var(--brand-blue-600) / <alpha-value>)",
          green: "rgb(var(--brand-green) / <alpha-value>)",
          "green-700": "rgb(var(--brand-green-700) / <alpha-value>)",
          gold: "rgb(var(--brand-gold) / <alpha-value>)",
          paper: "rgb(var(--paper) / <alpha-value>)",
        },
        ink: "#1E2A33",
        muted: "#5B6B77",
        line: "#E3E9EF",
      },
      fontFamily: {
        sans: ["var(--font-dm-sans)", "system-ui", "sans-serif"],
      },
      boxShadow: {
        card: "0 1px 2px rgba(2,62,113,0.06), 0 1px 3px rgba(2,62,113,0.05)",
        panel: "0 4px 20px rgba(2,62,113,0.08)",
      },
      borderRadius: {
        xl: "0.85rem",
      },
    },
  },
  plugins: [],
};

export default config;
