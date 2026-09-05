/**
 * In-app help.
 *
 * The help is for people with no accounting background — site staff and office
 * administrators as often as the accountant — so these check two things: that
 * every screen has an article written for it, and that someone searching for
 * what they want to do finds it rather than the title someone happened to pick.
 */
import { HELP_ARTICLES, HELP_CATEGORIES, articlesForPath, searchArticles } from "../src/lib/help.ts";

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  PASS ${name}${extra ? "  — " + extra : ""}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? "  — " + extra : ""}`); }
};

/* ------------------------------------------------------------ shape ----- */
ok("there are articles", HELP_ARTICLES.length >= 40, `${HELP_ARTICLES.length} articles`);
ok("every article has a title and a summary", HELP_ARTICLES.every((a) => a.title && a.summary));
ok("every article sits in a known category",
  HELP_ARTICLES.every((a) => HELP_CATEGORIES.includes(a.category)),
  [...new Set(HELP_ARTICLES.map((a) => a.category))].join(", "));

const ids = HELP_ARTICLES.map((a) => a.id);
ok("article ids are unique", new Set(ids).size === ids.length);

// Something to read beyond the one-line summary.
const thin = HELP_ARTICLES.filter((a) => !a.body && !(a.steps && a.steps.length));
ok("every article explains itself", thin.length === 0, thin.map((a) => a.id).join(", ") || "all have body or steps");

/* ------------------------------------------- the ? button on a screen --- */
// The article offered first should be the one written for that screen, not a
// general article that happens to list it.
const expected = [
  ["/finance", "Accounting terms in plain English"],
  ["/finance/daybook", "The Day Book"],
  ["/finance/ledgers", "Ledgers and account statements"],
  ["/finance/reports", "Profit & Loss and Balance Sheet"],
  ["/finance/vat", "The VAT return (VAT 201)"],
  ["/finance/parties", "Customers and suppliers"],
  ["/finance/outstanding", "Who owes us, and what we owe"],
  ["/hr/payroll", "Running payroll"],
  ["/hr/separation", "Separation & end-of-service settlement"],
];
for (const [path, title] of expected) {
  const first = articlesForPath(path)[0];
  ok(`${path} offers its own article first`, first?.title === title, first?.title ?? "none");
}

/* ------------------------------------------ every screen is covered ----- */
const SCREENS = [
  "/dashboard", "/finance", "/finance/daybook", "/finance/ledgers", "/finance/reports",
  "/finance/vat", "/finance/parties", "/finance/outstanding", "/finance/tally",
  "/hr", "/hr/onboarding", "/hr/payroll", "/hr/leave", "/hr/attendance",
  "/hr/certifications", "/hr/reports", "/hr/separation", "/hr/tasks",
  "/approvals", "/users", "/settings/roles", "/notifications", "/companies",
];
const uncovered = SCREENS.filter((s) => articlesForPath(s).length === 0);
ok("every screen has help", uncovered.length === 0, uncovered.join(", ") || `${SCREENS.length} screens`);

/* -------------------------------------------------------- searching ----- */
// People search for the task, not the heading.
const searches = [
  ["correct a mistake", "Correcting a mistake"],
  ["closed period", "Closing a period"],
  ["reverse charge", "Reverse charge — buying services from abroad"],
  ["who owes us money", "Who owes us, and what we owe"],
  ["ageing", "Who owes us, and what we owe"],
  ["print a report", "Printing a report"],
  ["opening balance", "Opening balances — moving from your old system"],
  ["back-dated invoice", "Recording a transaction"],
  ["TRN", "Customers and suppliers"],
];
for (const [q, title] of searches) {
  const first = searchArticles(q)[0];
  ok(`searching "${q}"`, first?.title === title, first?.title ?? "NO RESULT");
}

ok("an empty search returns nothing", searchArticles("").length === 0 && searchArticles("  ").length === 0);
ok("nonsense returns nothing", searchArticles("zzzqqq").length === 0);
// A short stem must not match inside an unrelated word.
ok("short words do not match inside longer ones",
  !searchArticles("age").some((a) => a.title === "Finding your way around"));

/* ----------------------------------------- the accounts work is there --- */
const covered = [
  ["voucher dating", "Recording a transaction"],
  ["corrections", "Correcting a mistake"],
  ["period lock", "Closing a period"],
  ["parties", "Customers and suppliers"],
  ["outstanding", "Who owes us, and what we owe"],
  ["VAT return", "The VAT return (VAT 201)"],
  ["VAT treatment", "Choosing the VAT treatment on a line"],
  ["reverse charge", "Reverse charge — buying services from abroad"],
  ["drill-down", "Following a figure back to its source"],
  ["printing", "Printing a report"],
];
for (const [what, title] of covered) {
  ok(`${what} is documented`, HELP_ARTICLES.some((a) => a.title === title));
}

ok("credit and debit notes are explained",
  HELP_ARTICLES.some((a) => (a.body ?? "").includes("Credit Note") && (a.body ?? "").includes("Debit Note")));

/* ------------------------------------------------ written for humans --- */
// The client's people have no accounting background; jargon without a worked
// example is not help.
const financeArticles = HELP_ARTICLES.filter((a) => a.category === "Finance & Accounting");
ok("finance help is substantial", financeArticles.length >= 15, `${financeArticles.length} finance articles`);
ok("most finance articles give a tip or worked example",
  financeArticles.filter((a) => a.tip).length >= financeArticles.length * 0.7,
  `${financeArticles.filter((a) => a.tip).length} of ${financeArticles.length} have tips`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
