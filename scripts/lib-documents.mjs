/**
 * Render the shipped PDF documents from a test, and read back where every line
 * of text landed on the page.
 *
 * Two defects got past a person looking at the PDF: a footer drawn thousands of
 * points off the sheet (the text was in the file, so text extraction "found"
 * it) and a company name printed over the address beneath it. Both are
 * questions of position, so this reads positions.
 *
 * src/documents is TSX, which node cannot load, so the documents and the lib
 * modules they reach are transpiled with sucrase into a temporary folder. For
 * drawing tests the database is an empty stub; test-document-loaders.mjs asks
 * for the real client to test the loaders.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import Module, { createRequire } from "node:module";
import { transform } from "sucrase";

const ROOT = process.cwd();

/**
 * Transpile src/documents and src/lib into a temp folder and return a require for it.
 *
 * `realDb` keeps the real Prisma client, for testing the loaders against the
 * local database; without it the database is an empty stub.
 */
export function loadDocuments({ realDb = false } = {}) {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "wb-docs-"));
  for (const dir of ["documents", "lib"]) {
    for (const f of fs.readdirSync(path.join(ROOT, "src", dir))) {
      if (!/\.(tsx?)$/.test(f) || f.startsWith(".")) continue;
      const src = fs.readFileSync(path.join(ROOT, "src", dir, f), "utf8").replace(/^import "server-only";.*$/m, "");
      const { code } = transform(src, { transforms: ["typescript", "jsx", "imports"], filePath: f, production: true });
      fs.mkdirSync(path.join(out, dir), { recursive: true });
      fs.writeFileSync(path.join(out, dir, f.replace(/\.tsx?$/, ".js")), code);
    }
  }
  // Drawing tests never touch the database.
  if (!realDb) fs.writeFileSync(path.join(out, "lib", "db.js"), "exports.db = {};");

  const original = Module._resolveFilename;
  Module._resolveFilename = function (request, parent, ...rest) {
    if (request.startsWith("@/")) request = path.join(out, request.slice(2));
    return original.call(this, request, parent, ...rest);
  };
  process.env.NODE_PATH = path.join(ROOT, "node_modules");
  Module._initPaths();

  const req = createRequire(path.join(out, "index.js"));
  return {
    require: req,
    cleanup() {
      Module._resolveFilename = original;
      fs.rmSync(out, { recursive: true, force: true });
    },
  };
}

const multiply = (m, n) => [
  m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3],
  m[2] * n[0] + m[3] * n[2], m[2] * n[1] + m[3] * n[3],
  m[4] * n[0] + m[5] * n[2] + n[4], m[4] * n[1] + m[5] * n[3] + n[5],
];

const decodeTJ = (arg) =>
  [...arg.matchAll(/<([0-9a-fA-F]*)>/g)]
    .map(([, hex]) => Buffer.from(hex, "hex").toString("latin1"))
    .join("");

/**
 * Every run of text in a PDF drawn by @react-pdf/renderer, page by page.
 *
 * `top` is measured down from the top edge of the sheet, as a person reads it.
 * Rotated text — the DRAFT watermark — is flagged rather than placed.
 */
export function readLayout(buffer) {
  const raw = buffer.toString("latin1");
  const box = raw.match(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/);
  const width = Number(box?.[1] ?? 595.28);
  const height = Number(box?.[2] ?? 841.89);

  const pages = [];
  let at = 0;
  while ((at = raw.indexOf("stream", at)) >= 0) {
    const start = raw.indexOf("\n", at) + 1;
    const end = raw.indexOf("endstream", start);
    at = end + 9;
    let content;
    try {
      content = zlib.inflateSync(buffer.subarray(start, end)).toString("latin1");
    } catch {
      continue;
    }
    if (!content.includes(" Tf")) continue;

    const runs = [];
    let ctm = [1, 0, 0, 1, 0, 0];
    const stack = [];
    let tm = [1, 0, 0, 1, 0, 0];
    let size = 0;
    for (const line of content.split("\n")) {
      const t = line.trim();
      if (t === "q") stack.push(ctm);
      else if (t === "Q") ctm = stack.pop() ?? [1, 0, 0, 1, 0, 0];
      else if (t.endsWith(" cm")) ctm = multiply(t.split(" ").slice(0, 6).map(Number), ctm);
      else if (t.endsWith(" Tm")) tm = t.split(" ").slice(0, 6).map(Number);
      else if (t.endsWith(" Tf")) size = Number(t.split(" ")[1]);
      else if (t.endsWith(" TJ")) {
        const m = multiply(tm, ctm);
        const text = decodeTJ(t);
        if (!text.trim()) continue;
        runs.push({
          text,
          size,
          left: m[4],
          top: height - m[5],
          rotated: Math.abs(m[1]) > 0.01 || Math.abs(m[2]) > 0.01,
        });
      }
    }
    pages.push(runs);
  }
  return { width, height, pages };
}

/**
 * Pairs of lines drawn over each other on the same page.
 *
 * Widths are estimated (Helvetica averages about half an em a character), so
 * this only compares lines that start close enough to share a column. Two runs
 * on the same baseline are the same line split by the renderer, not an overlap.
 */
export function overlaps(runs) {
  const found = [];
  const flat = runs.filter((r) => !r.rotated);
  for (let i = 0; i < flat.length; i++) {
    for (let j = 0; j < flat.length; j++) {
      const a = flat[i], b = flat[j];
      if (i === j || b.top <= a.top) continue; // a is the upper line
      const gap = b.top - a.top;
      if (gap < 0.5) continue;
      const aRight = a.left + a.text.length * a.size * 0.5;
      const bRight = b.left + b.text.length * b.size * 0.5;
      if (aRight <= b.left || bRight <= a.left) continue;
      // Descent of the upper line plus ascent of the lower one.
      if (gap < a.size * 0.2 + b.size * 0.72) found.push([a.text.trim(), b.text.trim(), Math.round(gap * 10) / 10]);
    }
  }
  return found;
}
