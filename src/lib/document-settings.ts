/**
 * What goes at the top and bottom of every document a company sends out.
 *
 * Quotations, purchase orders, notes, invoices and payslips all carry the same
 * letterhead, so it is worked out once here and every document reads it. When
 * the client's own templates arrive they will mostly be artwork — a header band
 * and a footer band — which is why both can be supplied as images and then
 * replace the generated letterhead everywhere at once.
 *
 * Not server-only, and no database: the settings screen checks input with the
 * same rules the documents rely on.
 */

export const DEFAULT_ACCENT = "#1F4E79";

/** Artwork is larger than a logo, but a letterhead band has no need to be huge. */
export const MAX_ARTWORK_BYTES = 800 * 1024;

export type DocumentSettingsLike = {
  accentColor?: string | null;
  headerImage?: string | null;
  footerImage?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  footerNote?: string | null;
  quotationTerms?: string | null;
  purchaseOrderTerms?: string | null;
  rfqTerms?: string | null;
  showSignatures?: boolean | null;
};

export type CompanyLike = {
  name: string;
  addressLine?: string | null;
  city?: string | null;
  emirate?: string | null;
  countryCode?: string | null;
  vatTRN?: string | null;
  logoUrl?: string | null;
};

export type Letterhead = {
  companyName: string;
  addressLine: string;
  /** "TRN 100…" when there is one. */
  trn: string;
  /** Phone · email · website, whichever exist. */
  contact: string;
  footerNote: string;
  /** Only PNG or JPEG. Anything else is dropped rather than drawn wrongly. */
  logo: string | null;
  headerImage: string | null;
  footerImage: string | null;
  accent: string;
  showSignatures: boolean;
  /** Said once, on the settings screen: the logo exists but cannot be drawn. */
  logoUnusable: boolean;
};

const PDF_IMAGE = /^data:image\/(png|jpeg|jpg);base64,[A-Za-z0-9+/=]+$/i;

/**
 * An image the PDF engine can draw, or nothing.
 *
 * The company logo may be SVG, WebP or GIF — the app accepts those for screens —
 * but the PDF engine reads only PNG and JPEG. Passing it anything else fails
 * the whole document, so an unusable image is left off and the company name
 * carries the letterhead instead. A document with no logo still goes out; a
 * document that fails to render does not.
 */
export function pdfImage(uri: string | null | undefined): string | null {
  const v = String(uri ?? "").trim();
  return PDF_IMAGE.test(v) ? v : null;
}

const clean = (v: string | null | undefined, max: number) => String(v ?? "").trim().slice(0, max);

export function letterheadFor(company: CompanyLike, settings: DocumentSettingsLike | null | undefined): Letterhead {
  const s = settings ?? {};
  const accent = /^#[0-9a-f]{6}$/i.test(String(s.accentColor ?? "")) ? String(s.accentColor) : DEFAULT_ACCENT;
  const logo = pdfImage(company.logoUrl);
  return {
    companyName: company.name,
    addressLine: [company.addressLine, company.city, company.emirate].map((x) => clean(x, 120)).filter(Boolean).join(", "),
    trn: company.vatTRN ? `TRN ${clean(company.vatTRN, 30)}` : "",
    contact: [s.phone, s.email, s.website].map((x) => clean(x, 120)).filter(Boolean).join("  ·  "),
    footerNote: clean(s.footerNote, 300),
    logo,
    headerImage: pdfImage(s.headerImage),
    footerImage: pdfImage(s.footerImage),
    accent,
    showSignatures: s.showSignatures !== false,
    logoUnusable: !!company.logoUrl && !logo,
  };
}

export type SettingsInput = {
  accentColor: string;
  headerImage: string;
  footerImage: string;
  phone: string;
  email: string;
  website: string;
  footerNote: string;
  quotationTerms: string;
  purchaseOrderTerms: string;
  rfqTerms: string;
  showSignatures: boolean;
};

export type CheckedSettings =
  | {
      ok: true;
      data: { [K in Exclude<keyof SettingsInput, "accentColor">]: SettingsInput[K] extends boolean ? boolean : string | null } & {
        accentColor: string;
      };
    }
  | { ok: false; error: string };

/** Check what the settings screen sends, in words a person can act on. */
export function checkDocumentSettings(input: SettingsInput): CheckedSettings {
  const accent = input.accentColor.trim() || DEFAULT_ACCENT;
  if (!/^#[0-9a-f]{6}$/i.test(accent)) {
    return { ok: false, error: "The accent colour must look like #1F4E79." };
  }

  for (const [label, value] of [["header", input.headerImage], ["footer", input.footerImage]] as const) {
    const v = value.trim();
    if (!v) continue;
    if (!pdfImage(v)) {
      return {
        ok: false,
        error: `The ${label} artwork must be a PNG or JPEG. Documents are PDFs, and PDFs cannot show other image types.`,
      };
    }
    // Base64 is four characters for every three bytes.
    if ((v.length * 3) / 4 > MAX_ARTWORK_BYTES) {
      return {
        ok: false,
        error: `The ${label} artwork is too large. Keep it under ${MAX_ARTWORK_BYTES / 1024} KB — a band across an A4 page needs about 2000 pixels wide at most.`,
      };
    }
  }

  const email = input.email.trim();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: "That does not look like an email address." };
  }

  const orNull = (v: string, max: number) => v.trim().slice(0, max) || null;
  return {
    ok: true,
    data: {
      accentColor: accent.toUpperCase(),
      headerImage: orNull(input.headerImage, 2_000_000),
      footerImage: orNull(input.footerImage, 2_000_000),
      phone: orNull(input.phone, 60),
      email: orNull(email, 120),
      website: orNull(input.website, 120),
      footerNote: orNull(input.footerNote, 300),
      quotationTerms: orNull(input.quotationTerms, 4000),
      purchaseOrderTerms: orNull(input.purchaseOrderTerms, 4000),
      rfqTerms: orNull(input.rfqTerms, 4000),
      showSignatures: input.showSignatures,
    },
  };
}
