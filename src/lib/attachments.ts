/**
 * Files kept beside a document.
 *
 * The client's own way of working, and the reason this exists: a supplier
 * sends their invoice with the government fee receipts behind it, a purchase
 * order is raised for the amount actually charged, and the whole bundle goes
 * for approval. An approver looking at AED 11,450 of government fees has to be
 * able to see the receipts, and an auditor asking a year later has to find
 * them in the same place — not in whoever's mailbox.
 *
 * One table for every kind of document rather than one per screen: what may be
 * uploaded, how it is written to disk and how it is served back are the same
 * questions each time (lib/uploads.ts answers them). What differs is who may
 * look, which is the screen key below — checked when a file goes up, and again
 * every time one comes back down.
 *
 * Pure, so the rules can be tested without a request or a database.
 */

export type Attachable = {
  /** The value stored in Attachment.entity. */
  entity: "Invoice" | "PurchaseOrder";
  /** What it is called on screen. */
  label: string;
  /** The screen whose view permission governs reading these files. */
  screen: string;
  /** What the kinds of file are, for the dropdown beside the picker. */
  kinds: string[];
};

export const ATTACHABLE: Attachable[] = [
  {
    entity: "Invoice",
    label: "Supplier bill",
    screen: "finance.invoices",
    kinds: ["Supplier invoice", "Government fee receipt", "Payment receipt", "Delivery note", "Other"],
  },
  {
    entity: "PurchaseOrder",
    label: "Purchase order",
    screen: "inventory.orders",
    kinds: ["Supplier invoice", "Government fee receipt", "Quotation", "Approval email", "Other"],
  },
];

export const attachableFor = (entity: string): Attachable | undefined =>
  ATTACHABLE.find((a) => a.entity === entity);

export const DEFAULT_KIND = "Other";

/** The kind as it will be stored: one of the offered ones, or the default. */
export function cleanKind(entity: string, value: unknown): string {
  const a = attachableFor(entity);
  const asked = typeof value === "string" ? value.trim() : "";
  return a && a.kinds.includes(asked) ? asked : DEFAULT_KIND;
}

/** Bytes as somebody would say them: "2.4 MB", "812 KB". */
export function fileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} bytes`;
}
