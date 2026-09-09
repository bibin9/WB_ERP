/**
 * Day / night theme regression tests.
 *
 * The theme works by routing every surface and text colour through CSS
 * variables that are redefined under html.dark. These checks catch the two ways
 * that quietly breaks: a hardcoded colour that never flips, and a token that
 * loses its dark definition.
 */
import fs from "fs";
import path from "path";

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  PASS ${name}${extra ? "  — " + extra : ""}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? "  — " + extra : ""}`); }
};
const read = (p) => fs.readFileSync(p, "utf8");
const walk = (dir, out = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else out.push(p.split(path.sep).join("/"));
  }
  return out;
};

const css = read("src/app/globals.css");
const tw = read("tailwind.config.ts");
const layout = read("src/app/layout.tsx");
const topbar = read("src/components/Topbar.tsx");
const toggle = read("src/components/ThemeToggle.tsx");

/* 1. Tailwind is set up for a class-driven theme. */
ok("darkMode is class-driven", /darkMode:\s*"class"/.test(tw));

/* 2. Surfaces and text run through variables, so utilities flip on their own. */
const TOKENS = ["surface", "heading", "ink", "muted", "line"];
const notVars = TOKENS.filter((t) => !new RegExp(`${t}: "rgb\\(var\\(--${t}\\)`).test(tw));
ok("surface + text colours are variable-driven", notVars.length === 0, notVars.join(", ") || TOKENS.join(", "));

/* 3. Both themes define every token. */
const lightBlock = css.slice(css.indexOf(":root {"), css.indexOf("html.dark {"));
const darkBlock = css.slice(css.indexOf("html.dark {"), css.indexOf(".theme-light {"));
const missingLight = TOKENS.filter((t) => !lightBlock.includes(`--${t}:`));
const missingDark = TOKENS.filter((t) => !darkBlock.includes(`--${t}:`));
ok("light theme defines every token", missingLight.length === 0, missingLight.join(", ") || "all present");
ok("dark theme redefines every token", missingDark.length === 0, missingDark.join(", ") || "all present");
ok("dark block outranks the tenant :root block", css.includes("html.dark {"));
ok("color-scheme is set for native controls", /color-scheme:\s*light/.test(css) && /color-scheme:\s*dark/.test(css));

/* 4. The switch exists, persists, and applies before first paint. */
ok("theme switch is in the top bar", topbar.includes("<ThemeToggle />"));
ok("choice is remembered", toggle.includes('"wb-erp.theme"') && toggle.includes("localStorage.setItem"));
ok("device setting is the default", toggle.includes("prefers-color-scheme: dark"));
ok("no flash of the wrong theme on load", layout.includes("wb-erp.theme") && layout.includes("classList.add('dark')"));

/* 5. Nothing is painted with a colour that cannot flip. */
const tsx = walk("src").filter((f) => f.endsWith(".tsx"));
// A document that leaves the building is paper, and paper is white in both
// themes. The rule runs one way only: anything painting itself white must opt
// into theme-light, which scopes the light palette to that subtree. The
// converse is not required — a logo preview scopes theme-light to show how the
// mark will look on paper, and is not itself a document.
const white = tsx.filter((f) => /bg-white["' ]/.test(read(f)));
const hardcoded = white.filter((f) => !read(f).includes("theme-light"));
ok("nothing paints itself white without scoping the light palette",
  hardcoded.length === 0, hardcoded.join(", ") || `${tsx.length} components checked`);
ok("and the white ones are the documents meant for paper",
  white.length > 0 && white.every((f) => /src\/app\/(statement|invoice)\//.test(f)),
  white.map((f) => f.split("/").slice(2, 4).join("/")).join(", "));
ok("the light palette itself exists", css.includes(".theme-light {"));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
