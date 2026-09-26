"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { FileSignature } from "lucide-react";
import { raiseOrderForBill } from "@/app/(app)/finance/invoices/actions";

/**
 * Raising the purchase order that approves a bill already received.
 *
 * The client's way round: a basic order goes to the supplier, the supplier
 * sends their invoice with the government receipts behind it, and the order
 * that gets approved is the one carrying the amount actually charged. So the
 * bill can raise its own order, copying its lines, and the bill cannot be
 * issued until that order has been approved — the approval is the control on
 * paying it, and it happens before the money moves rather than after.
 */
export default function OrderForBill({
  invoiceId,
  status,
  order,
  canRaise,
}: {
  invoiceId: string;
  status: string;
  order: { id: string; number: string; status: string; total: number } | null;
  canRaise: boolean;
}) {
  const [busy, start] = useTransition();
  const [error, setError] = useState("");

  if (order) {
    const approved = ["Approved", "Partly received", "Received"].includes(order.status);
    return (
      <div className="card p-5">
        <div className="mb-2 flex items-center gap-2 text-heading">
          <FileSignature className="h-4 w-4" />
          <h2 className="font-semibold">Purchase order</h2>
        </div>
        <p className="text-sm text-ink">
          This bill is against{" "}
          <Link href="/inventory/orders?show=all" className="text-brand-blue-600 hover:underline">{order.number}</Link>
          , which is <span className="font-medium">{order.status.toLowerCase()}</span>.
        </p>
        <p className="mt-1 text-xs text-muted">
          {approved
            ? "Approved, so this bill can be issued and posted."
            : "The bill cannot be issued until the order has been approved. That approval is the decision to pay it."}
        </p>
      </div>
    );
  }

  if (!canRaise) return null;

  return (
    <div className="card p-5">
      <div className="mb-2 flex items-center gap-2 text-heading">
        <FileSignature className="h-4 w-4" />
        <h2 className="font-semibold">Purchase order</h2>
      </div>
      <p className="max-w-2xl text-sm text-muted">
        No order is linked to this bill. Raise one from it and the lines, supplier and amounts are copied across, so
        what goes for approval is what the supplier actually charged. Attach their invoice and any receipts first —
        the approvers see them with it.
      </p>
      <button
        type="button"
        disabled={busy || status !== "Draft"}
        onClick={() =>
          start(async () => {
            setError("");
            const res = await raiseOrderForBill(invoiceId);
            if (!res.ok) setError(res.error ?? "Could not raise it.");
          })
        }
        className="btn-primary mt-3 disabled:opacity-50"
      >
        {busy ? "Raising…" : "Raise a purchase order from this bill"}
      </button>
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
    </div>
  );
}
