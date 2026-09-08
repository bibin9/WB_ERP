/**
 * The letterhead on a printed report.
 *
 * Only appears on paper — on screen the page's own heading does this job. It
 * carries the three things a printed page is useless without once it leaves the
 * building: whose company it is, what the report is, and what period it covers.
 *
 * The logo comes from the company rather than the tenant, because a group runs
 * several companies and a report for one of them must not go out on another's
 * letterhead. If no logo is set the name alone is used, which is why the layout
 * does not reserve space for an image that may not exist.
 */
export default function PrintHeader({
  companyName,
  logoUrl,
  title,
  subtitle,
}: {
  companyName: string;
  logoUrl?: string | null;
  /** The report's name, as it should read on paper. */
  title: string;
  /** Usually the period, sometimes an "as at" date. */
  subtitle?: string;
}) {
  return (
    <div className="print-header mb-4 flex items-start gap-4 border-b border-line pb-3">
      {logoUrl && (
        // Plain <img>: this is a data URI or an external mark, and the printed
        // page must not depend on an optimiser that may not have run.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={logoUrl}
          alt=""
          className="h-12 w-auto max-w-[180px] object-contain"
        />
      )}
      <div className="min-w-0">
        <div className="text-lg font-bold text-heading">{companyName}</div>
        <div className="text-sm text-ink">{title}</div>
        {subtitle && <div className="text-xs text-muted">{subtitle}</div>}
      </div>
    </div>
  );
}
