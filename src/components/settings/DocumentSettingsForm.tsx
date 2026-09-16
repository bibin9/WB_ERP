"use client";

import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import { saveDocumentSettings } from "@/app/(app)/settings/documents/actions";
import ArtworkField from "@/components/settings/ArtworkField";
import { DEFAULT_ACCENT, MAX_ARTWORK_BYTES } from "@/lib/document-settings";

export type ExistingDocumentSettings = {
  accentColor: string;
  headerImage: string | null;
  footerImage: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  footerNote: string | null;
  quotationTerms: string | null;
  purchaseOrderTerms: string | null;
  rfqTerms: string | null;
  showSignatures: boolean;
};

/**
 * The company's letterhead and standard wording for printed documents.
 *
 * Two ways to brand a document, and the screen says which is in use: the
 * generated letterhead (logo, name, address, TRN, a coloured rule) works on day
 * one; the company's own header and footer artwork, once their designer
 * supplies it, replaces that band on every document at once.
 */
export default function DocumentSettingsForm({
  companyId,
  existing,
}: {
  companyId: string;
  existing: ExistingDocumentSettings | null;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const [accent, setAccent] = useState(existing?.accentColor ?? DEFAULT_ACCENT);

  const terms: [keyof ExistingDocumentSettings, string, string][] = [
    ["quotationTerms", "Quotation terms", "Payment, validity, exclusions. A quotation with its own terms uses those instead."],
    ["purchaseOrderTerms", "Purchase order terms", "Delivery, invoicing, test certificates, rejection of non-conforming goods."],
    ["rfqTerms", "Enquiry (RFQ) terms", "What a supplier's price must include and how long it must stay valid."],
  ];

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        setError("");
        setSaved("");
        setBusy(true);
        const res = await saveDocumentSettings(fd);
        setBusy(false);
        if (res.ok) setSaved("Saved. Every document printed from now on uses these settings.");
        else setError(res.error);
      }}
      className="space-y-5"
    >
      <input type="hidden" name="companyId" value={companyId} />

      <section className="card space-y-4 p-5">
        <h2 className="text-sm font-medium uppercase tracking-wide text-muted">Letterhead</h2>

        <div className="grid gap-5 md:grid-cols-2">
          <ArtworkField
            name="headerImage"
            label="Header artwork"
            empty="None — the generated letterhead is used"
            maxBytes={MAX_ARTWORK_BYTES}
            defaultValue={existing?.headerImage ?? ""}
            hint="Your designed letterhead band, as a wide PNG or JPEG. It replaces the logo, name and address at the top of every page."
          />
          <ArtworkField
            name="footerImage"
            label="Footer artwork"
            empty="None — the footer line below is used"
            maxBytes={MAX_ARTWORK_BYTES}
            defaultValue={existing?.footerImage ?? ""}
            hint="Optional. A band across the bottom of every page — registration details, certifications, branch addresses."
          />
        </div>

        <div className="grid gap-3 md:grid-cols-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-ink">Accent colour</label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                aria-label="Pick the accent colour"
                value={/^#[0-9a-f]{6}$/i.test(accent) ? accent : DEFAULT_ACCENT}
                onChange={(e) => setAccent(e.target.value.toUpperCase())}
                className="h-9 w-10 cursor-pointer rounded border border-line bg-surface p-0.5"
              />
              <input
                name="accentColor"
                className="input font-mono"
                value={accent}
                onChange={(e) => setAccent(e.target.value)}
                maxLength={7}
              />
            </div>
            <p className="mt-1 text-xs text-muted">Titles, rules and table headings.</p>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-ink">Phone</label>
            <input name="phone" className="input" defaultValue={existing?.phone ?? ""} placeholder="+971 4 000 0000" />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-ink">Email</label>
            <input name="email" className="input" defaultValue={existing?.email ?? ""} placeholder="info@yourcompany.ae" />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-ink">Website</label>
            <input name="website" className="input" defaultValue={existing?.website ?? ""} placeholder="www.yourcompany.ae" />
          </div>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-ink">Footer line</label>
          <input
            name="footerNote"
            className="input"
            maxLength={300}
            defaultValue={existing?.footerNote ?? ""}
            placeholder="Trade licence no. 000000 · P.O. Box 0000, Dubai"
          />
          <p className="mt-1 text-xs text-muted">Printed above the company name at the foot of each page. Not shown when footer artwork is used.</p>
        </div>

        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="showSignatures" className="mt-0.5" defaultChecked={existing?.showSignatures ?? true} />
          <span>
            <span className="font-medium text-ink">Print signature boxes</span>
            <span className="mt-0.5 block text-xs text-muted">
              Prepared by, approved by and received by, at the end of each document.
            </span>
          </span>
        </label>
      </section>

      <section className="card space-y-4 p-5">
        <h2 className="text-sm font-medium uppercase tracking-wide text-muted">Standard terms</h2>
        {terms.map(([name, label, hint]) => (
          <div key={name}>
            <label className="mb-1 block text-sm font-medium text-ink">{label}</label>
            <textarea
              name={name}
              rows={5}
              maxLength={4000}
              className="input"
              defaultValue={(existing?.[name] as string | null) ?? ""}
            />
            <p className="mt-1 text-xs text-muted">{hint}</p>
          </div>
        ))}
      </section>

      {error && <p className="text-sm text-brand-gold">{error}</p>}
      {saved && <p className="text-sm text-brand-green-700">{saved}</p>}

      <div className="flex justify-end">
        <button disabled={busy} className="btn-primary disabled:opacity-50">
          <ShieldCheck className="h-4 w-4" /> {busy ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}
