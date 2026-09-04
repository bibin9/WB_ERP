# Documentation

Project and end-user documentation for the White & Bright Group ERP.

| Document | Audience | Purpose |
|---|---|---|
| **White_and_Bright_ERP_User_Manual.docx** | End users | Step-by-step guide to every screen, with 25 embedded screenshots. Version 1.3. |
| **White_and_Bright_ERP_Test_Cases.xlsx** | QA / testing team | 141 test cases across all modules, with a Status tracker and auto-counting Summary. |
| **White_and_Bright_ERP_BRD_v1.2_APPROVED.docx** | Client / stakeholders | Business Requirements Document (approved baseline). |
| **White_and_Bright_ERP_FSD_v1.1.docx** | Developers / stakeholders | Functional Specification (aligned to BRD v1.2). |
| **White_and_Bright_ERP_Technical_Proposal.docx** | Client | One-page technical proposal. |
| **White_and_Bright_ERP_Pilot_SOW.docx** | Client | Pilot statement of work (no cost). |

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
- **Opening balances & reporting periods** — carry balances in from the old system, and
  run every finance report for any date range. Profit & Loss covers the period; the
  Balance Sheet is a snapshot at its end date. Manual sections 4.2 and 4.3;
  test cases TC-FIN-013 to TC-FIN-025.
- **Data export** — an Export button on every list screen, plus an administrator-only
  "Export all data" producing a ZIP of spreadsheets. Scoped to the user's companies and
  permissions, and audit-logged. Test cases TC-GEN-003 to TC-GEN-010.

In-app help (the **?** button in the top bar, and the Help Center) covers the same
ground in plain English — 39 articles, including "Salary advances and loans",
"The WPS file for the bank", "Your dashboard fits your job", "Why a button is missing", "Day mode and night mode" "Getting your data out", "Opening balances" and "Choosing the dates a report covers".

## Screenshots

The two screens that changed most since the screenshots were taken are **Payroll**
(now with the Advance column, the advances panel and the WPS controls) and the
**Dashboard**. Fresh captures of those two would bring every figure fully up to date.
