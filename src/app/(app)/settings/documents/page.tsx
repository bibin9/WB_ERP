import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import CompanyPicker from "@/components/CompanyPicker";
import DocumentButtons from "@/components/DocumentButtons";
import DocumentSettingsForm from "@/components/settings/DocumentSettingsForm";
import { requireAccess } from "@/lib/guard";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { letterheadFor } from "@/lib/document-settings";

export const dynamic = "force-dynamic";

/**
 * How this company's printed documents look — quotations, purchase orders,
 * store notes and the rest all read the same letterhead from here.
 */
export default async function DocumentSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string }>;
}) {
  await requireAccess("settings.documents");
  const session = await getSession();
  const sp = await searchParams;
  const accessible = session?.companies ?? [];
  const companyId = accessible.find((c) => c.id === sp.c)?.id ?? accessible[0]?.id ?? "";

  const company = companyId
    ? await db.company.findUnique({ where: { id: companyId }, include: { documentSettings: true } })
    : null;
  const s = company?.documentSettings ?? null;
  const lh = company ? letterheadFor(company, s) : null;

  const verdict = !lh
    ? "Choose a company."
    : lh.headerImage
      ? "Documents print on your own header artwork."
      : lh.logo
        ? "Documents print with a generated letterhead: your logo, name, address and TRN."
        : "Documents print with a generated letterhead: company name, address and TRN, with no logo yet.";

  return (
    <div>
      <PageHeader title="Printed Documents" subtitle={verdict} />

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <CompanyPicker
          companies={accessible.map((c) => ({ id: c.id, code: c.code, name: c.name }))}
          current={companyId}
        />
        {companyId && (
          <div className="flex items-center gap-2 text-sm text-muted">
            See it on paper (saved settings):
            <DocumentButtons kind="letterhead-sample" id={companyId} label="sample" />
          </div>
        )}
      </div>

      {lh && (!company?.vatTRN || !lh.addressLine || lh.logoUnusable) && (
        <div className="mb-5 space-y-1 rounded border border-brand-gold/40 bg-brand-gold/10 p-3 text-sm text-ink">
          {lh.logoUnusable && (
            <p>
              The company logo is not a PNG or JPEG, so documents leave it off — PDFs cannot draw that image type.
              Upload a PNG version on <Link href="/companies" className="underline">Companies</Link>.
            </p>
          )}
          {!company?.vatTRN && (
            <p>
              No VAT TRN is saved for this company. A tax invoice is not valid without it — add it on{" "}
              <Link href="/companies" className="underline">Companies</Link>.
            </p>
          )}
          {!lh.addressLine && (
            <p>
              No address is saved for this company, so the letterhead shows only its name. Add it on{" "}
              <Link href="/companies" className="underline">Companies</Link>.
            </p>
          )}
        </div>
      )}

      {companyId && (
        <DocumentSettingsForm
          // A different company is a different form, not the same form with stale values.
          key={companyId}
          companyId={companyId}
          existing={
            s
              ? {
                  accentColor: s.accentColor,
                  headerImage: s.headerImage,
                  footerImage: s.footerImage,
                  phone: s.phone,
                  email: s.email,
                  website: s.website,
                  footerNote: s.footerNote,
                  quotationTerms: s.quotationTerms,
                  purchaseOrderTerms: s.purchaseOrderTerms,
                  rfqTerms: s.rfqTerms,
                  showSignatures: s.showSignatures,
                }
              : null
          }
        />
      )}

      {s?.updatedBy && (
        <p className="mt-4 text-xs text-muted">
          Last saved by {s.updatedBy} on{" "}
          {s.updatedAt.toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Dubai" })}.
        </p>
      )}
    </div>
  );
}
