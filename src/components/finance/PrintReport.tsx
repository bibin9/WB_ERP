"use client";

import { Printer } from "lucide-react";

/**
 * Sends the report to the printer, or to Save as PDF.
 *
 * An auditor needs a signed hard copy of the P&L, Balance Sheet, trial balance
 * and ledger. A CSV is for working on; it is not what goes in the file.
 */
export default function PrintReport({ label = "Print" }: { label?: string }) {
  return (
    <button onClick={() => window.print()} className="btn-ghost print:hidden" title="Print or save as PDF">
      <Printer className="h-4 w-4" />
      {label}
    </button>
  );
}
