/**
 * Build docs/bat-roles.html — the Roles & Access Rights sheet for the business
 * acceptance testers — from the role definitions themselves.
 *
 * The rights table is not typed: it is read from the seed's role defaults
 * (what every built-in role on Pre-Prod has) and the screen list the access
 * check uses, so it cannot say a tester may do something the system refuses.
 * The logins table is read from the acceptance scripts, so the check counts
 * match the page the testers work from.
 *
 *   node --experimental-strip-types scripts/make-bat-roles-sheet.mjs
 *
 * Run it again whenever a role's defaults or the acceptance scripts change.
 */
import fs from "node:fs";
import { SCREENS } from "../src/lib/rbac.ts";

/* ------------------------------------------------ the roles, from the seed */
const seed = fs.readFileSync("prisma/seed.mjs", "utf8");
const start = seed.indexOf("const V = ");
const end = seed.indexOf("];", seed.indexOf("const ROLES = [")) + 2;
const { ROLES, expandPerms } = new Function(seed.slice(start, end) + "\nreturn { ROLES, expandPerms };")();

/* ----------------------------------- the testers' roles, from the scripts */
const scripts = fs.readFileSync("docs/acceptance-scripts.html", "utf8");
const grab = (name) => {
  const at = scripts.indexOf(`const ${name} = [`);
  let i = scripts.indexOf("[", at), depth = 0, inStr = null;
  for (let j = i; j < scripts.length; j++) {
    const c = scripts[j];
    if (inStr) { if (c === "\\") { j++; continue; } if (c === inStr) inStr = null; continue; }
    if (c === '"' || c === "'" || c === "`") { inStr = c; continue; }
    if (c === "[") depth++;
    if (c === "]" && --depth === 0) return new Function(`return ${scripts.slice(i, j + 1)};`)();
  }
};
const BAT_ROLES = grab("ROLES");
const CASES = grab("CASES");

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const ACTIONS = ["view", "create", "edit", "delete", "approve"];
const LETTER = { view: "V", create: "C", edit: "E", delete: "D", approve: "A" };
const everything = (r) => r.approvalLevel >= 80 || r.name === "Group Admin";
const roleByName = Object.fromEntries(ROLES.map((r) => [r.name, r]));

/* -------------------------------------------------------- logins to make */
// Operations & Directors is two people: four-eyes means the Director cannot
// be the Operations Manager who approved the step before.
const LOGINS = [
  { bat: "ADM", as: ["Group Admin"], count: 1, note: "The client's own administrator. The only person who tests as Group Admin." },
  { bat: "EST", as: ["Estimation / Sales Engineer"], count: 1, note: "Enquiries, estimates and quotations; issues approved quotations and records orders." },
  { bat: "APR", as: ["Operations Manager", "Director"], count: 2, note: "Two people: the Operations Manager, then a Director. Add a Managing Director only to test orders from AED 50,000 or quotations from AED 500,000." },
  { bat: "SITE", as: ["Site Engineer / Planner"], count: 1, note: "Raises material requests; approves the first step of other people's." },
  { bat: "PM", as: ["Project Manager"], count: 1, note: "Approves requests and orders for their jobs; raises their own request." },
  { bat: "PRC", as: ["Procurement Officer"], count: 1, note: "Enquiries, three quotes, awards and purchase orders." },
  { bat: "STR", as: ["Storekeeper"], count: 1, note: "Receives, issues, transfers and takes back returns." },
  { bat: "QA", as: ["QA/QC & Calibration"], count: 1, note: "Passes or fails deliveries; keeps equipment calibrated." },
  { bat: "FIN", as: ["Finance / Accounts"], count: 1, note: "Drafts and issues invoices, credit notes and supplier bills." },
  { bat: "FC", as: ["Finance Controller"], count: 1, note: "Reports, VAT, cash flow, the period lock, and approving the payroll run." },
  { bat: "HR", as: ["HR Officer"], count: 1, note: "Employees, attendance, payroll, payslips and settlements. Prepares the payroll run; the Finance Controller approves it." },
  { bat: "TK", as: ["Site Timekeeper"], count: 1, note: "The daily site muster and hours against each job — nothing else." },
];
const totalLogins = LOGINS.reduce((a, l) => a + l.count, 0);

/* -------------------------------------------------- the rights matrix -- */
const COLUMNS = [
  "Operations Manager", "Finance Controller", "Finance / Accounts", "Project Manager", "Site Engineer / Planner",
  "Procurement Officer", "Storekeeper", "QA/QC & Calibration", "Estimation / Sales Engineer", "HR Officer", "HSE Officer", "Site Timekeeper",
];
const SHORT = {
  "Operations Manager": "Ops Mgr", "Finance Controller": "Fin Ctrl", "Finance / Accounts": "Accounts",
  "Project Manager": "Proj Mgr", "Site Engineer / Planner": "Site Eng", "Procurement Officer": "Procure",
  "Storekeeper": "Store", "QA/QC & Calibration": "QA/QC", "Estimation / Sales Engineer": "Estimator", "HR Officer": "HR",
  "HSE Officer": "HSE", "Site Timekeeper": "Timekeeper",
};
const rights = Object.fromEntries(COLUMNS.map((n) => [n, expandPerms(roleByName[n]?.permissions ?? {})]));
const MODULE_LABEL = {
  dashboard: "Dashboard", companies: "Companies", finance: "Finance & Accounting", hr: "HR & Admin", approvals: "Approvals",
  inventory: "Inventory & SCM", crm: "CRM & Estimation", projects: "Projects", hse: "HSE", users: "Users & Access",
  audit: "Audit", settings: "Settings", reports: "Reports", export: "Export",
};
const modules = [...new Set(SCREENS.map((s) => s.module))];
const cell = (roleName, screen) => {
  const p = rights[roleName];
  const acts = new Set([...(p[screen.key] ?? []), ...(p[screen.module] ?? [])]);
  const have = ACTIONS.filter((a) => acts.has(a));
  if (!have.length) return `<td class="none" aria-label="no access">·</td>`;
  return `<td><span class="r">${have.map((a) => `<b class="${a}" title="${a}">${LETTER[a]}</b>`).join("")}</span></td>`;
};
const matrix = modules.map((m) => {
  const rows = SCREENS.filter((s) => s.module === m);
  const anyone = rows.some((s) => COLUMNS.some((n) => { const p = rights[n]; return (p[s.key] ?? []).length || (p[s.module] ?? []).length; }));
  return `<tbody>
    <tr class="mod"><th colspan="${COLUMNS.length + 1}" scope="rowgroup">${esc(MODULE_LABEL[m] ?? m)}${anyone ? "" : " <span>— Directors and the Group Admin only</span>"}</th></tr>
    ${rows.map((s) => `<tr><th scope="row">${esc(s.label)}</th>${COLUMNS.map((n) => cell(n, s)).join("")}</tr>`).join("\n    ")}
  </tbody>`;
}).join("\n");

const checksFor = (bat) => CASES.filter((c) => c.r === bat).map((c) => c.id);
const loginRows = LOGINS.map((l) => {
  const bat = BAT_ROLES.find((r) => r.id === l.bat);
  const ids = checksFor(l.bat);
  const levels = l.as.map((n) => `L${roleByName[n]?.approvalLevel ?? "?"}`).join(" · ");
  return `<tr>
      <td><span class="tag">${esc(l.bat)}</span> ${esc(bat?.name ?? l.bat)}</td>
      <td>${l.as.map((n) => `<span class="sys">${esc(n)}</span>`).join("<br>")}</td>
      <td class="n">${levels}</td>
      <td class="n big">${l.count}</td>
      <td class="n">${ids.length}</td>
      <td>${esc(l.note)}</td>
    </tr>`;
}).join("\n");

const today = new Date().toISOString().slice(0, 10);

const html = `<title>BAT Roles &amp; Access</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow+Semi+Condensed:wght@600;700&family=Barlow:wght@400;500;600&family=JetBrains+Mono:wght@400;600&display=swap">
<style>
  :root{
    --ground:#F2F5F4; --panel:#FFFFFF; --sunk:#E7ECEA;
    --ink:#15201D; --ink-2:#41504B; --ink-3:#6E7B77;
    --rule:#D2DAD7; --rule-soft:#E4E9E7;
    --accent:#0B5F6B; --accent-bg:#DFEEF0;
    --v:#E3E9E7; --v-ink:#41504B;
    --c:#DCEBDF; --c-ink:#1C6B3F;
    --e:#DDE7F2; --e-ink:#23507F;
    --d:#F6E1DE; --d-ink:#9A2A20;
    --a:#F4E8CF; --a-ink:#7A4C00;
    --disp:'Barlow Semi Condensed','Arial Narrow',system-ui,sans-serif;
    --body:'Barlow',system-ui,-apple-system,'Segoe UI',sans-serif;
    --mono:'JetBrains Mono',ui-monospace,Consolas,monospace;
  }
  @media (prefers-color-scheme:dark){
    :root:not([data-theme="light"]){
      --ground:#0D1312; --panel:#141C1A; --sunk:#1C2624;
      --ink:#E5ECE9; --ink-2:#AEBAB6; --ink-3:#7E8B87;
      --rule:#29342F; --rule-soft:#1F2926;
      --accent:#62B9C5; --accent-bg:#11292D;
      --v:#222D2A; --v-ink:#AEBAB6; --c:#12301F; --c-ink:#6FD39B; --e:#152536; --e-ink:#8EB9E6;
      --d:#3A1814; --d-ink:#F29A90; --a:#33280F; --a-ink:#E2B25E;
    }
  }
  :root[data-theme="dark"]{
    --ground:#0D1312; --panel:#141C1A; --sunk:#1C2624;
    --ink:#E5ECE9; --ink-2:#AEBAB6; --ink-3:#7E8B87;
    --rule:#29342F; --rule-soft:#1F2926;
    --accent:#62B9C5; --accent-bg:#11292D;
    --v:#222D2A; --v-ink:#AEBAB6; --c:#12301F; --c-ink:#6FD39B; --e:#152536; --e-ink:#8EB9E6;
    --d:#3A1814; --d-ink:#F29A90; --a:#33280F; --a-ink:#E2B25E;
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--ground);color:var(--ink);font-family:var(--body);font-size:15.5px;line-height:1.55;-webkit-font-smoothing:antialiased}
  .wrap{max-width:68rem;margin:0 auto;padding-inline:16px;padding-block:2rem 5rem}
  h1,h2,h3{font-family:var(--disp);line-height:1.12;margin:0;text-wrap:balance}
  h1{font-size:clamp(2rem,5vw,2.8rem);font-weight:700;margin-top:.4rem}
  h2{font-size:1.55rem;font-weight:700;margin-top:2.6rem}
  p{margin:.6rem 0;max-width:70ch}
  .kicker{font-family:var(--mono);font-size:.7rem;letter-spacing:.14em;text-transform:uppercase;color:var(--ink-3)}
  .lede{font-size:1.08rem;color:var(--ink-2);max-width:62ch}
  .facts{display:flex;flex-wrap:wrap;gap:.5rem 1.6rem;margin-top:1.2rem;font-size:.9rem;color:var(--ink-2)}
  .facts b{font-family:var(--disp);font-size:1.35rem;color:var(--ink);margin-right:.25rem;font-variant-numeric:tabular-nums}
  .tw{overflow-x:auto;margin-top:1rem;background:var(--panel);border:1px solid var(--rule);border-radius:6px}
  table{border-collapse:collapse;width:100%;font-size:.88rem}
  th,td{padding:.5rem .65rem;border-top:1px solid var(--rule-soft);vertical-align:top;text-align:left}
  thead th{font-size:.68rem;letter-spacing:.08em;text-transform:uppercase;color:var(--ink-3);background:var(--sunk);border-top:0;white-space:nowrap}
  td.n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
  td.big{font-family:var(--disp);font-size:1.2rem;font-weight:700}
  .tag{font-family:var(--mono);font-size:.72rem;font-weight:600;color:var(--accent);background:var(--accent-bg);border-radius:3px;padding:.05rem .35rem;margin-right:.3rem}
  .sys{font-weight:600}
  .note{background:var(--panel);border:1px solid var(--rule);border-left:4px solid var(--accent);border-radius:5px;padding:.8rem 1rem;margin-top:1rem;max-width:72ch}
  .note b{font-family:var(--disp);font-size:1.02rem}
  ul{padding-left:1.2rem;max-width:70ch} li{margin:.3rem 0}
  /* rights matrix */
  .matrix table{font-size:.82rem}
  .matrix thead th{position:sticky;top:0;z-index:1}
  .matrix thead th.role{writing-mode:vertical-rl;transform:rotate(180deg);height:7.2rem;text-align:left;padding:.5rem .35rem;letter-spacing:.06em}
  .matrix tbody th,.matrix thead th:first-child{font-weight:500;white-space:nowrap;padding-right:1rem;position:sticky;left:0;background:var(--panel);z-index:2}
  .matrix thead th:first-child{background:var(--sunk);z-index:3}
  .matrix tr.mod th{background:var(--sunk);font-family:var(--disp);font-size:.95rem;font-weight:700;color:var(--ink);letter-spacing:.02em;padding-top:.6rem}
  .matrix tr.mod th span{font-family:var(--body);font-size:.8rem;font-weight:400;color:var(--ink-3)}
  .matrix td{text-align:center;padding:.4rem .3rem;white-space:nowrap}
  .matrix td.none{color:var(--ink-3)}
  .r{display:inline-flex;gap:2px}
  .r b{font-family:var(--mono);font-size:.68rem;font-weight:600;width:1.15rem;height:1.15rem;display:inline-grid;place-items:center;border-radius:3px}
  .r b.view{background:var(--v);color:var(--v-ink)} .r b.create{background:var(--c);color:var(--c-ink)}
  .r b.edit{background:var(--e);color:var(--e-ink)} .r b.delete{background:var(--d);color:var(--d-ink)}
  .r b.approve{background:var(--a);color:var(--a-ink)}
  .legend{display:flex;flex-wrap:wrap;gap:.4rem 1.1rem;margin-top:.8rem;font-size:.85rem;color:var(--ink-2)}
  .legend span{display:inline-flex;align-items:center;gap:.35rem}
  pre{background:var(--panel);border:1px solid var(--rule);border-radius:6px;padding:.8rem 1rem;font-family:var(--mono);font-size:.8rem;overflow-x:auto}
  footer{margin-top:3rem;font-size:.82rem;color:var(--ink-3);max-width:70ch}
  @media print{ body{background:#fff} .tw{border-color:#ccc} .matrix thead th{position:static} }
</style>

<div class="wrap">
  <header>
    <div class="kicker">Business acceptance testing · Pre-Prod</div>
    <h1>BAT Roles &amp; Access Rights</h1>
    <p class="lede">Who signs in as what for acceptance testing, and exactly what each role can see and do. Every tester uses their own login on the role they will really do — nobody tests as the administrator, because a screen that works for the Group Admin can still be refused to the storekeeper, and finding that is the point.</p>
    <div class="facts">
      <span><b>${totalLogins}</b> logins</span>
      <span><b>${LOGINS.length}</b> tester roles</span>
      <span><b>${CASES.length}</b> acceptance checks</span>
      <span>Company for testing: <b style="font-size:1.05rem">WBE</b></span>
    </div>
  </header>

  <h2>Logins to create</h2>
  <p>One login per person, each in the company <b>WBE — WB Engineering</b> unless a check says otherwise. The number of checks is from the Acceptance Scripts.</p>
  <div class="tw"><table>
    <thead><tr><th>Tester</th><th>Signs in as (role)</th><th class="n">Level</th><th class="n">Logins</th><th class="n">Checks</th><th>What they test</th></tr></thead>
    <tbody>
${loginRows}
    </tbody>
  </table></div>

  <div class="note"><b>Four eyes needs different people.</b> Nobody can approve a request they raised, and nobody can decide two steps of the same request. So the Site Engineer, Project Manager, Operations Manager, Director and Procurement Officer must be <i>different people</i> — one person holding two of those logins will be refused at the second step, correctly.</div>
  <div class="note"><b>Passwords.</b> Each login starts with a temporary password that must be changed at the first sign-in, to at least 10 characters. Temporary passwords are handed to each tester privately — never in a group chat or email thread.</div>

  <h2>What each role can do</h2>
  <p>Read across a row to see who can use a screen, or down a column to see everything one role can do. A dot means the screen is not in that role's menu at all. <b>Directors, the Managing Director and the Group Admin can do everything</b>, so they are not shown.</p>
  <div class="legend">
    <span><span class="r"><b class="view">V</b></span> View</span>
    <span><span class="r"><b class="create">C</b></span> Create</span>
    <span><span class="r"><b class="edit">E</b></span> Edit</span>
    <span><span class="r"><b class="delete">D</b></span> Delete</span>
    <span><span class="r"><b class="approve">A</b></span> Approve — issue, award, approve in the inbox, lock the books</span>
  </div>
  <div class="tw matrix"><table>
    <thead><tr><th>Screen</th>${COLUMNS.map((n) => `<th class="role" scope="col" title="${esc(n)} (L${roleByName[n]?.approvalLevel ?? "?"})">${esc(SHORT[n])}</th>`).join("")}</tr></thead>
${matrix}
  </table></div>

  <h2>The access review</h2>
  <p>On 21 September 2026 every role was checked against what its work needs. The built-in roles used to be given whole modules, and each module grant had grown as screens were added — a Site Engineer could read every employee's salary. Each role now names only its screens, and three separations hold:</p>
  <ul>
    <li><b>Salaries, payroll and settlements</b> are for HR, the Finance Controller (payroll only) and directors. Operations Manager, Project Manager, Site Engineer and HSE Officer see the operational HR screens — attendance, man-hours, tasks, certifications — and no pay.</li>
    <li><b>Whoever orders does not receive, and whoever receives does not inspect.</b> Procurement raises enquiries and orders; the Storekeeper receives and issues; QA/QC passes or fails deliveries.</li>
    <li><b>HR prepares the payroll run; the Finance Controller approves it.</b> Finance / Accounts can no longer change Finance Settings, Tally or Corporate Tax.</li>
  </ul>
  <p>The Site Timekeeper is a new built-in role with Attendance &amp; Muster and nothing else.</p>

  <h2>Changed for BAT</h2>
  <p>Setting up the testers found six acceptance checks given to a role that could not do them — each tester would have recorded a failure that was really a missing permission. Decided on 21 September 2026:</p>
  <ul>
    <li><b>Accounts issues invoices.</b> Finance / Accounts has Approve on Invoices: issuing posts the invoice and gives it its number. (FIN-02, FIN-03, FIN-07)</li>
    <li><b>The estimator issues approved quotations and records the order.</b> Estimation / Sales Engineer has Approve on Quotations. The Operations Manager and a Director must still approve the quotation first. (EST-09, EST-11)</li>
    <li><b>The Finance Controller locks the books.</b> Finance → Setup → <i>Lock the books</i>, for anyone with Approve on Finance Settings. A future date is refused and every change is in the audit log. (FC-03)</li>
  </ul>

  <h2>Sending the tester list</h2>
  <p>To create the logins, send the list as a spreadsheet saved as CSV with these four columns. Companies are codes separated by a semicolon. The rows below are examples only.</p>
  <pre>name,email,role,companies
Example Storekeeper,store.test@example.com,Storekeeper,WBE
Example Accountant,accounts.test@example.com,Finance / Accounts,WBE
Example Director,director.test@example.com,Director,WBE;WBTS</pre>
  <p>Role names must match the “Signs in as” column exactly. An email that already has a login is left as it is.</p>

  <footer>
    Built ${today} from the role definitions the system uses and the Acceptance Scripts (${CASES.length} checks). If a tester finds they can do something this page says they cannot — or cannot do something it says they can — record it as a failure: either the system or this page is wrong, and both matter.
  </footer>
</div>
`;

fs.writeFileSync("docs/bat-roles.html", html);
console.log(`docs/bat-roles.html — ${totalLogins} logins, ${COLUMNS.length} roles in the matrix, ${SCREENS.length} screens, ${CASES.length} checks`);
