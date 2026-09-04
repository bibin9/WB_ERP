# Documentation

Project and end-user documentation for the White & Bright Group ERP.

| Document | Audience | Purpose |
|---|---|---|
| **White_and_Bright_ERP_User_Manual.docx** | End users | Step-by-step guide to every screen, with 25 embedded screenshots. Version 1.1. |
| **White_and_Bright_ERP_Test_Cases.xlsx** | QA / testing team | 109 test cases across all modules, with a Status tracker and auto-counting Summary. |
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

In-app help (the **?** button in the top bar, and the Help Center) covers the same
ground in plain English — 35 articles, including "Salary advances and loans",
"The WPS file for the bank", "Your dashboard fits your job" and "Why a button is missing".

## Screenshots

The two screens that changed most since the screenshots were taken are **Payroll**
(now with the Advance column, the advances panel and the WPS controls) and the
**Dashboard**. Fresh captures of those two would bring every figure fully up to date.
