/**
 * Responsive-shell regression tests.
 *
 * The app shell used to be fixed-width: a 256px sidebar with no mobile handling,
 * which left ~119px of content on a 375px phone. These checks keep the drawer
 * behaviour and the table scroll wrappers in place.
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

const sidebar = read("src/components/Sidebar.tsx");
const topbar = read("src/components/Topbar.tsx");
const layout = read("src/app/(app)/layout.tsx");

/* 1. The sidebar is an off-canvas drawer below lg, and part of the layout above it. */
ok("sidebar is off-canvas below lg", /fixed inset-y-0 left-0[^"]*lg:static/.test(sidebar));
ok("sidebar slides in when opened", sidebar.includes("-translate-x-full") && sidebar.includes("lg:translate-x-0"));
ok("drawer has a backdrop", /fixed inset-0[^"]*lg:hidden/.test(sidebar));

/* 2. It can actually be opened and closed on a phone. */
ok("top bar has a menu button below lg", read("src/components/NavToggle.tsx").includes("lg:hidden") && topbar.includes("<NavToggle />"));
ok("sidebar listens for the toggle", sidebar.includes('"wb-erp:toggle-nav"'));
ok("Escape closes the drawer", /Escape/.test(sidebar));
ok("navigating closes the drawer", /setMobileOpen\(false\);\s*\}, \[pathname\]\)/.test(sidebar));
ok("drawer has a close control", sidebar.includes('title="Close menu"'));

/* 3. The icon-only rail stays a desktop affordance — a phone drawer shows labels. */
ok("collapsed rail is desktop-only", /const rail = collapsed && isDesktop;/.test(sidebar));
ok("desktop is detected by media query", sidebar.includes('matchMedia("(min-width: 1024px)")'));

/* 4. Content gets the full width of a phone screen. */
ok("main padding is responsive", /p-4 sm:p-6/.test(layout));

/* 5. Every table can scroll inside its own container, so no page scrolls sideways. */
const pages = walk("src/app").filter((f) => f.endsWith(".tsx") && read(f).includes("<table"));
const unwrapped = pages.filter((f) => !read(f).includes("overflow-x-auto"));
ok("every page with a table has a scroll wrapper", unwrapped.length === 0, unwrapped.join(", ") || `${pages.length} pages checked`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
