"use client";

import { Printer } from "lucide-react";

export default function PrintButton() {
  return (
    <button
      onClick={() => window.print()}
      className="inline-flex items-center gap-2 rounded-lg bg-brand-navy px-4 py-2 text-sm font-medium text-white hover:opacity-90 print:hidden"
    >
      <Printer className="h-4 w-4" /> Print / Save as PDF
    </button>
  );
}
