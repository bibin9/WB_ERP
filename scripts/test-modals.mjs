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

/*
 * A refused form keeps what the user typed.
 *
 * React resets a form with an `action` prop once the action resolves, whether
 * it was accepted or refused. Every form in this app is controlled by useState,
 * so the reset put the DOM back to its defaults while the state driving the
 * helper text kept the old values. A storeman who tried to issue more pipe than
 * was free to use got the right refusal above a form that had lost his item,
 * store, bin and job, and still said "that bin holds 181" about an item no
 * longer selected.
 *
 * `onSubmit` with preventDefault does not reset, so what the user typed is
 * still there to correct. Forms that want a reset ask for one.
 */
const components = walk("src/components").concat(walk("src/app"));
const autoReset = components.filter((f) => /action=\{async \(fd\)/.test(read(f)));
ok(
  "no form throws away what was typed when it is refused",
  autoReset.length === 0,
  autoReset.map((f) => f.replace("src/", "")).join(", ") ||
    `${components.length} files checked`,
);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
