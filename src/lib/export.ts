/**
 * CSV generation for the data-export feature.
 *
 * Excel is the destination for nearly every export a client asks for, so the
 * output is shaped for it: CRLF line endings, a UTF-8 byte-order mark so Arabic
 * names and the dirham sign survive a double-click, and a leading apostrophe on
 * values Excel would otherwise mangle into dates or numbers (an employee number
 * like "03-2026", an IBAN, a long ID).
 */

export type Column<T> = {
  header: string;
  value: (row: T) => string | number | Date | null | undefined;
};

// Written as an escape, not a literal: U+FEFF is legal JavaScript whitespace,
// so a raw one in the source can be stripped by the minifier and Excel then
// opens the file as Latin-1, mangling Arabic names.
const BOM = "\uFEFF";

/** Values Excel silently reinterprets unless they are forced to text. */
function excelSafe(s: string): string {
  if (s === "") return s;
  // A leading =, +, - or @ is treated as a formula: the CSV-injection vector.
  if (/^[=+\-@\t\r]/.test(s)) return "'" + s;
  return s;
}

function cell(v: string | number | Date | null | undefined): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10); // YYYY-MM-DD sorts correctly
  if (typeof v === "number") return String(v);
  const s = excelSafe(String(v));
  // Quote when the value contains a delimiter, quote or newline; double any quotes.
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Build a CSV string (with BOM) from rows and an explicit column list. */
export function toCsv<T>(rows: T[], columns: Column<T>[]): string {
  const head = columns.map((c) => cell(c.header)).join(",");
  const body = rows.map((r) => columns.map((c) => cell(c.value(r))).join(",")).join("\r\n");
  return BOM + head + (rows.length ? "\r\n" + body : "") + "\r\n";
}

/** A filename that sorts by date and is safe on Windows. */
export function exportFilename(what: string, companyCode: string, ext = "csv"): string {
  const stamp = new Date().toISOString().slice(0, 10);
  const safe = `${companyCode}-${what}`.replace(/[^A-Za-z0-9._-]+/g, "-");
  return `${safe}-${stamp}.${ext}`;
}
