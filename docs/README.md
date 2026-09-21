# Documentation

Project and end-user documentation for the White & Bright Group ERP.

| Document | Audience | Purpose |
|---|---|---|
| **White_and_Bright_ERP_User_Manual.docx** | End users | Step-by-step guide to every screen, with 25 embedded screenshots. Version 1.5. |
| **White_and_Bright_ERP_Test_Cases.xlsx** | QA / testing team | 214 test cases across all modules, with a Status tracker and auto-counting Summary. |
| **White_and_Bright_ERP_BRD_v1.2_APPROVED.docx** | Client / stakeholders | Business Requirements Document (approved baseline). |
| **White_and_Bright_ERP_FSD_v1.1.docx** | Developers / stakeholders | Functional Specification (aligned to BRD v1.2). |
| **White_and_Bright_ERP_Technical_Proposal.docx** | Client | One-page technical proposal. |
| **White_and_Bright_ERP_Pilot_SOW.docx** | Client | Pilot statement of work (no cost). |

| **White_and_Bright_ERP_User_Handbook.pdf** | End users / client | The Handbook as a 45-page A4 PDF (September 2026 edition): contents with page numbers, footer on every page. Printed from handbook.html. |
| **White_and_Bright_ERP_Acceptance_Scripts.xlsx** | Client testers | UAT workbook: Start here (instructions, severity, worked example), Summary (counts and go-live readiness, all formulas), and one sheet per role with the 94 checks, Result/Severity drop-downs and yellow cells to fill. Same checks as acceptance-scripts.html. |
| **performance-test-report.html** | Project team / client | Stress and performance test of Pre-Prod, 17 September 2026 (claude.ai artifact JvWp23ftnrDYG8Y8ffP6mZ): findings PT-01 to PT-07, fixes, before-and-after re-test, speed, web load, verified clean-up, open items. |
| **handbook.html** | End users | Source of the online Handbook (claude.ai artifact 1J7JvDYZF6UbFXPfgWy7iH). Covers Finance, HR, CRM & Estimation, Inventory & SCM, printed documents. September 2026 edition. |
| **acceptance-scripts.html** | Client testers | Source of the online Acceptance Scripts (claude.ai artifact U5vN4ae8eNzA6mzyvBRyKb): 94 role-by-role UAT checks with expected results; each tester records Pass / Fail / Blocked and downloads a CSV. |
| **bat-roles.html** | Client testers, administrator | Source of the BAT Roles & Access Rights sheet (claude.ai artifact Kr2SzexhYgG1YhRU8VSwrv): which login each tester uses, and every role's rights screen by screen. Generated — rebuild with `node --experimental-strip-types scripts/make-bat-roles-sheet.mjs`, never edit by hand. |

Edit these two files and republish to the same artifact addresses; do not publish a new copy, or the link the client has goes stale.

See also **/DEPLOY.md** in the repo root for the Railway deployment guide.

## What changed in this revision

The manual (v1.0 to v1.1) and the test pack (80 to 109 cases) were updated to cover
functionality added after the first documentation pack:

- **Salary advances** — record an advance once and it is recovered automatically from
  each payslip until cleared. Manual section 5.3; test cases TC-HR-009 to TC-HR-015.
- **UAE WPS SIF export** — generate the Salary Information File the bank needs in order
  to pay staff. Manual section 5.3; test cases TC-HR-016 to TC-HR-021.
- **Role-adaptive dashboard** — one dashboard that shows only the panels a user has
  access to. Manual section 3; test cases TC-DASH-003 to TC-DASH-008.
- **Per-action rights** — View, Create, Edit, Delete and Approve are granted separately
  per screen, enforced behind the screen as well as in the interface, so controls a role
  may not use are not displayed. Manual section 7.2; test cases TC-RBAC-008 to TC-RBAC-017.
- **Phone and tablet layout** — the menu becomes a slide-over drawer below 1024px so the
  content gets the full screen width. Desktop is unchanged. Manual section 2.6;
  test cases TC-GEN-017 to TC-GEN-021.
- **Day and night mode** — a sun/moon switch in the top bar, remembered per device and
  defaulting to the device's own setting. Manual section 2.5; test cases TC-GEN-011 to
  TC-GEN-016.
- **Accounts module, rebuilt against an accountant's review** — voucher dating and a
  period lock, correction by reversal rather than editing history, customer and
  supplier masters with TRN, outstanding with ageing, credit and debit notes,
  drill-down from any report line to the ledger and the voucher, printable reports,
  and a UAE VAT 201 return with per-line treatment and reverse charge.
  Manual chapter 4 (rewritten); test cases TC-FIN-001 to TC-FIN-070.
- **Opening balances & reporting periods** — carry balances in from the old system, and
  run every finance report for any date range. Profit & Loss covers the period; the
  Balance Sheet is a snapshot at its end date. Manual sections 4.2 and 4.3.
- **Data export** — an Export button on every list screen, plus an administrator-only
  "Export all data" producing a ZIP of spreadsheets. Scoped to the user's companies and
  permissions, and audit-logged. Test cases TC-GEN-003 to TC-GEN-010.

In-app help (the **?** button in the top bar, and the Help Center) covers the same
ground in plain English — 47 articles, including "Salary advances and loans",
"The WPS file for the bank", "Your dashboard fits your job", "Why a button is missing", "Day mode and night mode" "Getting your data out", "Opening balances", "Correcting a mistake", "Who owes us, and what we owe", "The VAT return (VAT 201)" and "Reverse charge — buying services from abroad".

## Screenshots

The two screens that changed most since the screenshots were taken are **Payroll**
(now with the Advance column, the advances panel and the WPS controls) and the
**Dashboard**. Fresh captures of those two would bring every figure fully up to date.
