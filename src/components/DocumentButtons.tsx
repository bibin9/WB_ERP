import { Printer, FileDown } from "lucide-react";

/**
 * Print and download for a document that leaves the building.
 *
 * Both open the same server-drawn PDF: printing opens it in the browser's own
 * PDF viewer, which prints it exactly as drawn, and downloading saves that same
 * file. So the copy on paper, the copy on disk and the copy that was emailed
 * cannot drift apart the way a printout of a screen does.
 */
export default function DocumentButtons({
  kind,
  id,
  label = "PDF",
  compact = false,
  title,
}: {
  kind: string;
  id: string;
  label?: string;
  /** One small link for a table row, where two buttons would crowd the cell. */
  compact?: boolean;
  /** What the compact link opens, for its tooltip — "Goods received note". */
  title?: string;
}) {
  const href = `/api/pdf/${kind}/${id}`;
  if (compact) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener"
        title={title ? `Print or download the ${title.toLowerCase()}` : "Print or download"}
        className="inline-flex items-center gap-1 text-xs text-brand-blue-600 hover:underline print:hidden"
      >
        <Printer className="h-3.5 w-3.5" /> {label}
      </a>
    );
  }
  return (
    <span className="inline-flex items-center gap-2 print:hidden">
      <a href={href} target="_blank" rel="noopener" className="btn-ghost inline-flex items-center gap-1.5">
        <Printer className="h-4 w-4" /> Print
      </a>
      <a href={`${href}?download=1`} className="btn-ghost inline-flex items-center gap-1.5">
        <FileDown className="h-4 w-4" /> Download {label}
      </a>
    </span>
  );
}
