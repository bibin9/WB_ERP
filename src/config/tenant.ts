/**
 * TENANT / WHITE-LABEL CONFIGURATION
 * =================================================================
 * This ERP is a PRODUCT. Everything customer-specific lives here so the
 * same codebase can be re-skinned and resold to any company.
 *
 * To onboard a new customer:
 *   1. Add/replace their logo files in /public/brand.
 *   2. Copy the `whiteAndBright` tenant below, change name, colours,
 *      logo and companies.
 *   3. Point `activeTenant` at the new config (or load it by domain/DB later).
 *
 * Colours are stored as "R G B" triplets so Tailwind can apply opacity
 * (e.g. bg-brand-green/20). They are injected as CSS variables at runtime,
 * so re-theming needs no rebuild.
 */

export type TenantTheme = {
  navy: string; // primary
  navy700: string;
  navy900: string;
  blue: string; // bright accent
  blue600: string;
  green: string; // action / success
  green700: string;
  gold: string; // warning / accent
  paper: string; // app background
};

export type TenantCompany = {
  id: string;
  code: string;
  name: string;
  short: string;
};

export type Tenant = {
  key: string;
  appName: string; // shown in the browser tab / meta
  productName: string; // shown to users in-app
  logo: string; // colour logo (light backgrounds)
  logoWhite: string; // white logo (dark backgrounds, e.g. sidebar)
  theme: TenantTheme;
  companies: TenantCompany[];
};

/** Default tenant — White & Bright Group (first customer). */
export const whiteAndBright: Tenant = {
  key: "wandb",
  appName: "White & Bright Group ERP",
  productName: "White & Bright Group",
  logo: "/brand/wb-logo.png",
  logoWhite: "/brand/wb-logo-white.png",
  theme: {
    navy: "2 62 113", // #023E71
    navy700: "5 55 97", // #053761
    navy900: "4 41 74", // #04294A
    blue: "41 171 226", // #29ABE2
    blue600: "30 144 199", // #1E90C7
    green: "97 177 90", // #61B15A
    green700: "78 148 72", // #4E9448
    gold: "224 163 0", // #E0A300
    paper: "250 252 250", // #FAFCFA
  },
  companies: [
    { id: "wbe", code: "WBE", name: "WB Engineering", short: "WB Engineering" },
    { id: "wbts", code: "WBTS", name: "WB Technical Services", short: "WB Technical Svc." },
    { id: "vts", code: "VTS", name: "Voice Technical Services", short: "Voice Technical Svc." },
  ],
};

/**
 * A neutral sample tenant — shows how the same product re-skins for
 * another customer just by changing this object.
 */
export const sampleTenant: Tenant = {
  key: "acme",
  appName: "Acme Contracting ERP",
  productName: "Acme Contracting",
  logo: "/brand/wb-logo.png",
  logoWhite: "/brand/wb-logo-white.png",
  theme: {
    navy: "31 41 55",
    navy700: "22 30 42",
    navy900: "15 21 30",
    blue: "59 130 246",
    blue600: "37 99 235",
    green: "16 185 129",
    green700: "5 150 105",
    gold: "234 179 8",
    paper: "249 250 251",
  },
  companies: [
    { id: "ac1", code: "AC", name: "Acme Contracting LLC", short: "Acme Contracting" },
    { id: "ac2", code: "AT", name: "Acme Trading", short: "Acme Trading" },
  ],
};

/** The tenant this deployment serves. Swap for a new customer, or load by domain/DB. */
export const activeTenant: Tenant = whiteAndBright;

/** Build the CSS-variable block that themes the whole app from a tenant. */
export function themeToCssVars(t: Tenant): string {
  const c = t.theme;
  return [
    `--brand-navy:${c.navy}`,
    `--brand-navy-700:${c.navy700}`,
    `--brand-navy-900:${c.navy900}`,
    `--brand-blue:${c.blue}`,
    `--brand-blue-600:${c.blue600}`,
    `--brand-green:${c.green}`,
    `--brand-green-700:${c.green700}`,
    `--brand-gold:${c.gold}`,
    `--paper:${c.paper}`,
  ].join(";");
}
