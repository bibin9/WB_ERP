/**
 * Which stock movements have a printed note, and what it is called.
 *
 * Kept out of src/documents so a screen can ask "does this row have a note?"
 * without pulling the PDF engine into the page.
 */
export const NOTE_TITLES: Record<string, string> = {
  Receipt: "GOODS RECEIVED NOTE",
  Issue: "MATERIAL ISSUE NOTE",
  "Return to supplier": "RETURN TO SUPPLIER NOTE",
  "Transfer out": "STOCK TRANSFER NOTE",
  "Transfer in": "STOCK TRANSFER NOTE",
};

/**
 * Adjustments have none: they record what a count found, not material handed
 * from one person to another, so there is nobody to sign for them.
 */
export const hasStoreNote = (kind: string): boolean => kind in NOTE_TITLES;
