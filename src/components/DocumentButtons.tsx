import { Printer, FileDown } from "lucide-react";

/**
 * Print and download for a document that leaves the building.
 *
 * Both open the same server-drawn PDF: printing opens it in the browser's own
 * PDF viewer, which prints it exactly as drawn, and downloading saves that same
 * file. So the copy on paper, the copy on disk and the copy that was emailed
 * cannot drift apart the way a printout of a screen does.
 */
export default function DocumentButtons({ kind, id, label = "PDF" }: { kind: string; id: string; label?: string }) {
  const href = `/api/pdf/${kind}/${id}`;
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
