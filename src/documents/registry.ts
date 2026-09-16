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
};
