/**
 * The letterhead every printed document reads.
 *
 * What matters: an image the PDF engine cannot draw never reaches it (one bad
 * logo would fail every document the company prints), the client's artwork is
 * used when supplied, and the settings screen refuses what the documents would
 * later choke on — in words a person can act on.
 */
import { importLibs } from "./lib-shim.mjs";

const { letterheadFor, checkDocumentSettings, pdfImage, DEFAULT_ACCENT, MAX_ARTWORK_BYTES } =
  await importLibs(["document-settings"]).then((m) => m["document-settings"]);

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  PASS ${name}${extra ? "  — " + extra : ""}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? "  — " + extra : ""}`); }
};

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==";
const JPEG = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==";
const SVG = "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=";

const company = { name: "White & Bright Engineering LLC", addressLine: "Office 12", city: "Dubai", emirate: "Dubai", vatTRN: "100123456700003", logoUrl: PNG };

/* ------------------------------------------------------- images ----- */
ok("a PNG is drawable", pdfImage(PNG) === PNG);
ok("a JPEG is drawable", pdfImage(JPEG) === JPEG);
ok("an SVG is not — the PDF engine cannot draw it", pdfImage(SVG) === null);
ok("an https URL is not — the server would fetch whatever it points at", pdfImage("https://example.com/logo.png") === null);
ok("script dressed as an image is not", pdfImage('data:image/png;base64,AAA"onerror=alert(1)') === null);

/* --------------------------------------------------- letterhead ----- */
const plain = letterheadFor(company, null);
ok("with no settings, the generated letterhead uses the logo", plain.logo === PNG && plain.headerImage === null);
ok("  and the address reads as one line", plain.addressLine === "Office 12, Dubai, Dubai", plain.addressLine);
ok("  and carries the TRN", plain.trn === "TRN 100123456700003");
ok("  in the default accent", plain.accent === DEFAULT_ACCENT);
ok("  with signature boxes", plain.showSignatures === true);

const svgLogo = letterheadFor({ ...company, logoUrl: SVG }, null);
ok("an SVG logo is left off rather than failing the document", svgLogo.logo === null);
ok("  and the settings screen is told why", svgLogo.logoUnusable === true);
ok("no logo at all is not reported as unusable", letterheadFor({ ...company, logoUrl: null }, null).logoUnusable === false);

const branded = letterheadFor(company, {
  headerImage: JPEG, footerImage: PNG, accentColor: "#8a1c1c", phone: "+971 4 000 0000", email: "info@wb.ae", website: "", showSignatures: false,
});
ok("the client's header artwork is used when supplied", branded.headerImage === JPEG);
ok("  and their footer", branded.footerImage === PNG);
ok("  their accent", branded.accent === "#8a1c1c");
ok("  contact details that exist, and no gap for the one that does not", branded.contact === "+971 4 000 0000  ·  info@wb.ae", branded.contact);
ok("  signature boxes can be turned off", branded.showSignatures === false);
ok("a malformed stored accent falls back rather than printing garbage",
  letterheadFor(company, { accentColor: "red; }" }).accent === DEFAULT_ACCENT);
ok("stored artwork that is not drawable is ignored",
  letterheadFor(company, { headerImage: SVG }).headerImage === null);

/* ------------------------------------------------------- saving ----- */
const blank = {
  accentColor: "", headerImage: "", footerImage: "", phone: "", email: "", website: "", footerNote: "",
  quotationTerms: "", purchaseOrderTerms: "", rfqTerms: "", showSignatures: true,
};

const empty = checkDocumentSettings(blank);
ok("an empty form saves", empty.ok);
ok("  with the default accent", empty.ok && empty.data.accentColor === DEFAULT_ACCENT);
ok("  and nothing stored as empty strings", empty.ok && empty.data.headerImage === null && empty.data.quotationTerms === null);

const svg = checkDocumentSettings({ ...blank, headerImage: SVG });
ok("SVG artwork is refused", !svg.ok);
ok("  saying why and what to do", !svg.ok && /PNG or JPEG/.test(svg.error), svg.ok ? "" : svg.error);

const huge = "data:image/png;base64," + "A".repeat(Math.ceil((MAX_ARTWORK_BYTES + 10_000) * 4 / 3));
const big = checkDocumentSettings({ ...blank, footerImage: huge });
ok("oversized artwork is refused", !big.ok && /too large/.test(big.error), big.ok ? "" : big.error);
ok("artwork just under the limit is accepted",
  checkDocumentSettings({ ...blank, footerImage: "data:image/png;base64," + "A".repeat(Math.floor((MAX_ARTWORK_BYTES - 1024) * 4 / 3)) }).ok);

ok("a colour that is not a hex colour is refused", !checkDocumentSettings({ ...blank, accentColor: "navy" }).ok);
ok("a lower-case colour is stored upper-case", (() => { const r = checkDocumentSettings({ ...blank, accentColor: "#1f4e79" }); return r.ok && r.data.accentColor === "#1F4E79"; })());
ok("a mistyped email is refused", !checkDocumentSettings({ ...blank, email: "info@wandb" }).ok);

const terms = checkDocumentSettings({ ...blank, purchaseOrderTerms: "  Delivery within 7 days.  " });
ok("terms are trimmed and kept", terms.ok && terms.data.purchaseOrderTerms === "Delivery within 7 days.");
ok("signatures off is kept", (() => { const r = checkDocumentSettings({ ...blank, showSignatures: false }); return r.ok && r.data.showSignatures === false; })());

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
