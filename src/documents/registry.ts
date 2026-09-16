/**
 * Every document the system prints, in one list.
 *
 * Each says which screen's permission guards it — the same screen the document
 * is opened from — so being able to print something never needs a grant of its
 * own, and nobody can download a PDF of what they could not open on screen.
 */
import React from "react";
import type { DocumentProps } from "@react-pdf/renderer";
import { loadQuotation, QuotationPdf } from "./quotation";
import { loadSample, SamplePdf } from "./sample";
import { loadPurchaseOrder, PurchaseOrderPdf } from "./purchase-order";
import { loadRfq, RfqPdf } from "./rfq";
import { loadMaterialRequest, MaterialRequestPdf } from "./material-request";
import { loadStoreNote, StoreNotePdf } from "./store-note";
import { loadMaterialReturn, MaterialReturnPdf } from "./material-return";

export type DocumentKind = {
  /** RBAC screen key; see lib/rbac. */
  screen: string;
  load: (id: string, companyIds: string[]) => Promise<{ filename: string } | null>;
  render: (data: never) => React.ReactElement<DocumentProps>;
};

const kind = <T extends { filename: string }>(
  screen: string,
  load: (id: string, companyIds: string[]) => Promise<T | null>,
  Component: (d: T) => React.ReactElement,
): DocumentKind => ({
  screen,
  load,
  render: ((d: T) => React.createElement(Component, d)) as unknown as DocumentKind["render"],
});

export const DOCUMENTS: Record<string, DocumentKind> = {
  quotation: kind("crm.quotations", loadQuotation, QuotationPdf),
  "purchase-order": kind("inventory.orders", loadPurchaseOrder, PurchaseOrderPdf),
  // The id is a supplier's place on the enquiry, or the enquiry for an unaddressed copy.
  rfq: kind("inventory.rfq", loadRfq, RfqPdf),
  "material-request": kind("inventory.requests", loadMaterialRequest, MaterialRequestPdf),
  // The id is any one movement; the note is every movement recorded with it.
  "store-note": kind("inventory.movements", loadStoreNote, StoreNotePdf),
  "material-return": kind("inventory.returns", loadMaterialReturn, MaterialReturnPdf),
  // The id is a company id: that company's letterhead on an invented document.
  "letterhead-sample": kind("settings.documents", loadSample, SamplePdf),
};
