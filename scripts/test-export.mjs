/**
 * Data-export tests.
 *
 * The CSV and ZIP writers are pure logic and easy to get subtly wrong — a
 * missing quote corrupts every row after it — so those are exercised for real.
 * The wiring and permissions are checked statically.
 */
import fs from "fs";
import path from "path";

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  PASS ${name}${extra ? "  — " + extra : ""}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? "  — " + extra : ""}`); }
};
const read = (p) => fs.readFileSync(p, "utf8");

/**
 * Import a TypeScript module by stripping its type annotations. Crude, but it
 * lets the real shipped logic be tested without adding a build step.
 */
async function importTs(file, replacements) {
  let src = read(file).replace(/^import "server-only";\r?\n/m, "");
  for (const [from, to] of replacements) src = src.split(from).join(to);
  const url = "data:text/javascript;base64," + Buffer.from(src, "utf8").toString("base64");
  return import(url);
}

const csv = await importTs("src/lib/export.ts", [
  ["export type Column<T> = {\n  header: string;\n  value: (row: T) => string | number | Date | null | undefined;\n};\n", ""],
  ["function excelSafe(s: string): string {", "function excelSafe(s) {"],
  ["function cell(v: string | number | Date | null | undefined): string {", "function cell(v) {"],
  ["export function toCsv<T>(rows: T[], columns: Column<T>[]): string {", "export function toCsv(rows, columns) {"],
  ['export function exportFilename(what: string, companyCode: string, ext = "csv"): string {', 'export function exportFilename(what, companyCode, ext = "csv") {'],
]);

const zip = await importTs("src/lib/zip.ts", [
  ["export type ZipEntry = { name: string; data: string | Buffer };\n", ""],
  ["const dosTime = (d: Date) =>", "const dosTime = (d) =>"],
  ["const dosDate = (d: Date) =>", "const dosDate = (d) =>"],
  ["export function createZip(entries: ZipEntry[], when = new Date()): Buffer {", "export function createZip(entries, when = new Date()) {"],
  ["const locals: Buffer[] = [];", "const locals = [];"],
  ["const centrals: Buffer[] = [];", "const centrals = [];"],
]);

/* ------------------------------------------------------------------- CSV -- */
const col = (h, f) => ({ header: h, value: f });
const one = (rows, cols) => csv.toCsv(rows, cols);

ok("BOM is emitted for Excel", Buffer.from(one([{ a: "x" }], [col("A", (r) => r.a)]), "utf8").subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])));
ok("CRLF line endings", one([{ a: "x" }], [col("A", (r) => r.a)]).includes("\r\n"));

const commas = one([{ a: "Smith, John" }], [col("Name", (r) => r.a)]);
ok("commas are quoted", commas.includes('"Smith, John"'), commas.trim().split("\r\n")[1]);

const quotes = one([{ a: 'He said "hi"' }], [col("Note", (r) => r.a)]);
ok("quotes are doubled", quotes.includes('"He said ""hi"""'));

const newline = one([{ a: "line1\nline2" }], [col("Note", (r) => r.a)]);
ok("newlines stay inside a quoted field", newline.includes('"line1\nline2"'));

const formula = one([{ a: "=1+1" }, { a: "+A1" }, { a: "-2" }, { a: "@SUM" }], [col("V", (r) => r.a)]);
const injected = formula.split("\r\n").slice(1, 5);
ok("formula injection is neutralised", injected.every((l) => l.startsWith("'")), injected.join(" | "));

const dates = one([{ d: new Date("2026-09-04T10:00:00Z") }], [col("When", (r) => r.d)]);
ok("dates are written as YYYY-MM-DD", dates.includes("2026-09-04"));

const nulls = one([{ a: null, b: undefined }], [col("A", (r) => r.a), col("B", (r) => r.b)]);
ok("null and undefined become empty cells", nulls.trim().endsWith(","), JSON.stringify(nulls.trim().split("\r\n")[1]));

const empty = one([], [col("A", (r) => r.a)]);
ok("no rows still yields a header", empty.includes("A") && empty.trim().split("\r\n").length === 1);

const name = csv.exportFilename("employees", "WBE");
ok("filename is dated and safe", /^WBE-employees-\d{4}-\d{2}-\d{2}\.csv$/.test(name), name);

/* ------------------------------------------------------------------- ZIP -- */
const archive = zip.createZip([
  { name: "a.csv", data: "col\r\nvalue\r\n" },
  { name: "big.csv", data: "x\r\n".repeat(3000) },
]);
ok("ZIP has the local-file signature", archive[0] === 0x50 && archive[1] === 0x4b && archive[2] === 3 && archive[3] === 4);
ok("ZIP ends with the central directory record", archive.subarray(-22).readUInt32LE(0) === 0x06054b50);
ok("ZIP records both entries", archive.subarray(-22).readUInt16LE(8) === 2);

// Walk the local headers the way an unzipper does.
let off = 0, entries = [];
while (off < archive.length - 4 && archive.readUInt32LE(off) === 0x04034b50) {
  const compSize = archive.readUInt32LE(off + 18);
  const nameLen = archive.readUInt16LE(off + 26);
  const extraLen = archive.readUInt16LE(off + 28);
  entries.push({ name: archive.subarray(off + 30, off + 30 + nameLen).toString("utf8"), method: archive.readUInt16LE(off + 8), compSize, raw: archive.readUInt32LE(off + 22) });
  off += 30 + nameLen + extraLen + compSize;
}
ok("entries are readable by walking headers", entries.length === 2, entries.map((e) => e.name).join(", "));
ok("repetitive content is deflated", entries[1].method === 8 && entries[1].compSize < entries[1].raw, `${entries[1].raw} -> ${entries[1].compSize} bytes`);

/* --------------------------------------------------------------- wiring --- */
const actions = read("src/app/(app)/export/actions.ts");
ok("every export checks a screen permission", /await allow\(ds\.screen, "view"\)/.test(actions));
ok("export-all is restricted to administrators", /await canAdminister\(\)/.test(actions));
ok("exports are scoped to the user's companies", actions.includes("session.companies.filter") && actions.includes("session.companies"));
ok("every export is written to the audit log", (actions.match(/await audit\(/g) || []).length >= 2);

// A "use server" module may only export async functions.
const badExports = [...actions.matchAll(/^export (?!async function|type )(\w+)/gm)].map((m) => m[0]);
ok("actions file exports only async functions", badExports.length === 0, badExports.join(", ") || "clean");

const button = read("src/components/ExportButton.tsx");
ok("client adds the BOM the transport strips", button.includes("0xfeff") && button.includes("uFEFF"));

const gitignore = read(".gitignore");
ok("exports are not committed by accident", gitignore.includes("backups/") && gitignore.includes("*.dump"));

// Every screen that lists data offers an export.
const wired = ["hr/page.tsx", "hr/payroll/page.tsx", "hr/leave/page.tsx", "hr/attendance/page.tsx", "hr/certifications/page.tsx", "hr/separation/page.tsx", "finance/page.tsx"]
  .filter((f) => read(path.join("src/app/(app)", f)).includes("ExportButton"));
ok("export buttons are wired to the list screens", wired.length === 7, `${wired.length}/7`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
