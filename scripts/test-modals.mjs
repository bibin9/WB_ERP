/**
 * Modals must not inherit the layout of whatever opened them.
 *
 * A modal opened from a table row is still a DOM child of that row's action
 * cell. `position: fixed` takes it out of the layout flow but not out of CSS
 * inheritance, so `whitespace-nowrap` and `text-right` on the cell — there to
 * keep the action buttons on one line and pushed right — reach every label and
 * paragraph inside the modal. Help text stops wrapping and runs across the next
 * column; every label goes right-aligned.
 *
 * It is invisible until a modal is opened from a row rather than from a page
 * header, which is why it survived several rounds of testing.
 */
import fs from "node:fs";
import path from "node:path";

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  PASS ${name}${extra ? "  — " + extra : ""}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? "  — " + extra : ""}`); }
};

const read = (p) => fs.readFileSync(p, "utf8");
const walk = (dir, out = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name).split(path.sep).join("/");
    if (e.isDirectory()) walk(p, out);
    else if (p.endsWith(".tsx")) out.push(p);
  }
  return out;
};

const files = walk("src/components");

/** The overlay every modal draws: fixed, full-screen, centring a card. */
const OVERLAY = /className="fixed inset-0 z-30 flex items-start justify-center([^"]*)"/g;

const overlays = [];
for (const f of files) {
  const s = read(f);
  for (const m of s.matchAll(OVERLAY)) overlays.push({ file: f.replace("src/components/", ""), cls: m[1] });
}

ok("the modal overlays are found", overlays.length > 10, `${overlays.length} overlays`);

const unwrapped = overlays.filter((o) => !o.cls.includes("whitespace-normal"));
ok("every modal overlay resets white-space", unwrapped.length === 0,
  unwrapped.length ? unwrapped.map((o) => o.file).join(", ") : `${overlays.length} checked`);

const unaligned = overlays.filter((o) => !o.cls.includes("text-left"));
ok("every modal overlay resets text-align", unaligned.length === 0,
  unaligned.length ? unaligned.map((o) => o.file).join(", ") : `${overlays.length} checked`);

/* The condition that made this reachable: row actions really do set both, and
   should keep doing so — the reset belongs on the modal, not on the cell. */
const pages = walk("src/app");
const actionCells = pages.filter((f) => /whitespace-nowrap[^"]*text-right/.test(read(f)));
ok("row action cells still keep their buttons on one line", actionCells.length > 0,
  `${actionCells.length} screen(s) — the reset is on the modal, not here`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
