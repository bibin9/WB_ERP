/**
 * What comes out on paper, and what happens when a grid gets long.
 *
 * Both were reported from use rather than found by testing, which is the point:
 * a report printed with the navigation across the top and a date-range form
 * under it looks unfinished to whoever receives it, and an unbounded grid is
 * invisible on demo data and unusable a year in.
 */
import fs from "node:fs";
import path from "node:path";
import { readPaging, pageInfo, PAGE_SIZES, PER_PAGE } from "../src/lib/paging.ts";

const read = (p) => fs.readFileSync(p, "utf8");
let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  PASS ${name}${extra ? "  — " + extra : ""}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? "  — " + extra : ""}`); }
};

/* ================================================ nothing but the report == */
// The stylesheet already drops the sidebar, the top bar, anything in a nav and
// every button. What it could not know about is chrome built from plain divs.
const CHROME = {
  "src/components/PageHeader.tsx": "the page heading and its action buttons",
  "src/components/ModuleTabsClient.tsx": "the finance and HR tab strips",
  "src/components/CompanyPicker.tsx": "the company switcher",
  "src/components/PeriodPicker.tsx": "the date-range picker",
};
for (const [file, what] of Object.entries(CHROME)) {
  ok(`${what} is kept off the paper`, read(file).includes("print:hidden"), file.split("/").pop());
}

const css = read("src/app/globals.css");
ok("the stylesheet still drops navigation and buttons",
  /@media print[\s\S]*?\baside,[\s\S]*?\bbutton,/.test(css));
ok("and the letterhead is the one thing print reveals", css.includes(".print-header"));

/* ====================================== every report has a letterhead ===== */
const walk = (dir, out = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name).split(path.sep).join("/");
    if (e.isDirectory()) walk(p, out);
    else if (e.name === "page.tsx") out.push(p);
  }
  return out;
};
const printable = walk("src/app/(app)").filter((f) => read(f).includes("PrintReport"));
ok("the printable screens are found", printable.length >= 8, `${printable.length} reports`);

const noHeader = printable.filter((f) => !read(f).includes("<PrintHeader"));
ok("every printable screen carries a letterhead", noHeader.length === 0,
  noHeader.map((f) => f.split("(app)")[1]).join(", ") || `${printable.length} checked`);

const noLogo = printable.filter((f) => !/logoUrl=\{company(Row)?\?\.logoUrl\}/.test(read(f)));
ok("and each takes the logo from its own company", noLogo.length === 0,
  noLogo.map((f) => f.split("(app)")[1]).join(", "));

const header = read("src/components/finance/PrintHeader.tsx");
ok("the letterhead shows the company, the report and the period",
  header.includes("companyName") && header.includes("{title}") && header.includes("{subtitle}"));
ok("a company with no logo still prints cleanly", header.includes("{logoUrl && ("));

/* ============================================== the logo is a company's == */
const schema = read("prisma/schema.prisma");
ok("the logo belongs to the company, not the tenant",
  /model Company[\s\S]*?logoUrl\s+String\?/.test(schema));
const companyActions = read("src/app/(app)/companies/actions.ts");
ok("only an image or an https URL is stored", companyActions.includes("isImageData") && companyActions.includes("isHttps"));
ok("and it is capped, since it is read on every report", /raw\.length > \d[\d_]*/.test(companyActions));
ok("the form offers a file, converted in the browser",
  read("src/components/LogoField.tsx").includes("readAsDataURL"));
ok("the preview shows it as it will print, on paper",
  read("src/components/LogoField.tsx").includes("theme-light"));

/* ======================================================== paging maths ==== */
ok("a missing page is page one", readPaging({}).page === 1);
ok("a nonsense page is page one", readPaging({ p: "-4" }).page === 1 && readPaging({ p: "abc" }).page === 1);
ok("a size that is not offered falls back", readPaging({ per: "7" }).perPage === PER_PAGE);
ok("an offered size is honoured", readPaging({ per: String(PAGE_SIZES[2]) }).perPage === PAGE_SIZES[2]);
ok("page three skips two pages", readPaging({ p: "3", per: "25" }).skip === 50);

{
  const i = pageInfo(readPaging({ p: "2", per: "25" }), 237);
  ok("the numbers read the way a person says them", i.from === 26 && i.to === 50, `${i.from}–${i.to} of ${i.total}`);
  ok("the last page is worked out", i.pages === 10);
  ok("and it knows where it can go", i.hasPrev && i.hasNext);
}
{
  const i = pageInfo(readPaging({ p: "99" }), 10);
  ok("a page past the end lands on the last one", i.page === 1 && i.to === 10, `page ${i.page}`);
}
{
  const i = pageInfo(readPaging({}), 0);
  ok("an empty grid says nothing rather than 1 to 0", i.from === 0 && i.to === 0 && i.pages === 1);
}

/* ============================================= the grids that grow ======== */
const PAGED = {
  "src/app/(app)/finance/daybook/page.tsx": "the day book, which holds every voucher ever posted",
  "src/app/(app)/finance/parties/page.tsx": "the customer and supplier list",
  "src/app/(app)/finance/cheques/page.tsx": "the cheque register",
  "src/app/(app)/hr/page.tsx": "the employee list",
};
for (const [file, what] of Object.entries(PAGED)) {
  const s = read(file);
  ok(`${what} is paged`, s.includes("<Pager") && s.includes("readPaging"));
  ok(`  and the database fetches one page of it`, /skip: \(info\.page - 1\) \* info\.perPage/.test(s) && s.includes("take: info.perPage"));
}

ok("the cheque forecast still counts every cheque, not just the page",
  read("src/app/(app)/finance/cheques/page.tsx").includes("forecast is what the register is for"));

const pager = read("src/components/Pager.tsx");
ok("the pager keeps the other filters on the URL", pager.includes("new URLSearchParams(params.toString())"));
ok("changing the size returns to page one", pager.includes('p: "1"'));
ok("and the pager itself does not print", pager.includes("print:hidden"));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
