/**
 * What may be uploaded, and what it is really.
 *
 * The document route served files back with a Content-Type taken straight from
 * the browser's `file.type` and a `Content-Disposition: inline`, and nothing
 * checked what was in the file. Upload an HTML page, declare it `text/html`,
 * and it rendered inside this application's own origin with the viewer's
 * session cookie in scope — and the route that did it is the one that serves
 * passports, visas and Emirates IDs, so the person most likely to open a
 * poisoned "certificate" is the HR user with access to all of them.
 *
 * Three things fix it and all three are needed:
 *
 *   - an allow-list, so only document and image types are accepted at all;
 *   - a look at the first few bytes, because the declared type and the
 *     extension are both written by whoever uploaded the file;
 *   - and serving what was DETECTED rather than what was claimed.
 *
 * Pure, so the upload action and the download route agree without either
 * importing the other.
 */

export type AllowedType = {
  /** What the file will be served as, whatever it claimed to be. */
  mime: string;
  label: string;
  extensions: string[];
  /** Leading bytes that identify the format, as hex. */
  magic: string[];
};

/**
 * What an HR file actually is: a scan, a photo, or an office document.
 *
 * Nothing executable, nothing the browser will render as a page, and no SVG —
 * SVG is XML, it carries script, and browsers run it.
 */
export const ALLOWED_TYPES: AllowedType[] = [
  { mime: "application/pdf", label: "PDF", extensions: [".pdf"], magic: ["25504446"] },
  { mime: "image/jpeg", label: "JPEG image", extensions: [".jpg", ".jpeg"], magic: ["ffd8ff"] },
  { mime: "image/png", label: "PNG image", extensions: [".png"], magic: ["89504e47"] },
  { mime: "image/webp", label: "WebP image", extensions: [".webp"], magic: ["52494646"] },
  { mime: "image/tiff", label: "TIFF scan", extensions: [".tif", ".tiff"], magic: ["49492a00", "4d4d002a"] },
  {
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    label: "Word document",
    extensions: [".docx"],
    // Every modern Office file is a zip. The extension separates them.
    magic: ["504b0304", "504b0506", "504b0708"],
  },
  {
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    label: "Excel workbook",
    extensions: [".xlsx"],
    magic: ["504b0304", "504b0506", "504b0708"],
  },
];

export const ALLOWED_EXTENSIONS = ALLOWED_TYPES.flatMap((t) => t.extensions);

/** For the file picker, so the browser filters before anybody waits on an upload. */
export const ACCEPT_ATTRIBUTE = ALLOWED_EXTENSIONS.join(",");

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

const hex = (bytes: Uint8Array, n: number) =>
  Array.from(bytes.slice(0, n))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

/**
 * What this file actually is, judged on its contents and its extension.
 *
 * The declared MIME type is not consulted at all. It is written by the client
 * and there is no version of trusting it that ends well.
 */
export function identify(
  filename: string,
  head: Uint8Array
): { ok: true; type: AllowedType } | { ok: false; error: string } {
  const dot = filename.lastIndexOf(".");
  const ext = dot === -1 ? "" : filename.slice(dot).toLowerCase();

  const byExtension = ALLOWED_TYPES.filter((t) => t.extensions.includes(ext));
  if (byExtension.length === 0) {
    return {
      ok: false,
      error: `Only ${ALLOWED_TYPES.map((t) => t.label).join(", ")} files can be uploaded. "${ext || filename}" is not one of them.`,
    };
  }

  const start = hex(head, 8);
  const match = byExtension.find((t) => t.magic.some((m) => start.startsWith(m)));
  if (!match) {
    return {
      ok: false,
      error:
        `That file is named "${filename}" but its contents are not ${byExtension[0].label}. ` +
        "Renaming a file does not change what it is, and a file pretending to be a document is the shape an attack takes.",
    };
  }
  return { ok: true, type: match };
}

/**
 * The headers a stored file is served with.
 *
 * `attachment` so nothing renders in this origin; `nosniff` so the browser does
 * not second-guess the type; and a CSP sandbox as a third line, which neuters
 * script and plugins even if the first two were somehow wrong.
 */
export function downloadHeaders(mime: string, filename: string): Record<string, string> {
  // A quoted filename with a quote in it splits the header. Strip the lot.
  const safe = filename.replace(/["\\\r\n]/g, "").slice(0, 200) || "document";
  return {
    "Content-Type": mime,
    "Content-Disposition": `attachment; filename="${safe}"`,
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
    "Cache-Control": "private, no-store",
  };
}
