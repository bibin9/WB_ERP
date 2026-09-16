# Phase 2

Everything phase 1 left open, in one place, so none of it is lost between
sessions. Phase 1 is complete and live; nothing here reaches the client until
it is merged to `main` deliberately.

Order is roughly by value to the business, not by effort.

---

## What the BRD says phase 2 is

The approved BRD (v1.2) calls phase 2 **Commercial & Supply**, delivering CRM
and Estimation, Inventory and SCM, and customer and vendor portals — "faster
quotations plus purchasing and stock control".

Tracked against the BRD's own references so scope can be agreed rather than
inferred.

### Inventory & SCM (§6.2)

| Ref | Requirement | Priority | State |
|---|---|---|---|
| INV-01 | Material request linked to the project | Must | **Done** |
| INV-02 | Check stock and flag shortages against the request | Must | **Done** |
| INV-03 | MR approval: Site In-Charge → Project Manager → Procurement | Must | **Done** |
| INV-04 | Approved MR triggers purchase or internal allocation | Must | **Done** — its lines carry across |
| INV-05 | Convert MR to PO; RFQ to vendors | Must | **Done** — PO and RFQ both |
| INV-06 | Vendor selection on price, lead time, past performance, min three | Must | **Done** — three enforced, reason required off-lowest, past performance shown on the comparison |
| INV-07 | Repeat purchases without re-bidding | Should | Not started |
| INV-08 | PO approval PM → OM → Director → MD | Must | **Done**, using the seeded route |
| INV-09 | Bid comparison sheets, PO from the chosen quotation | Should | **Done** — the PO is built from the winning quote |
| INV-10 | Goods receipt on delivery | Must | **Done** |
| INV-11 | QA/QC inspection; accepted stored, rejected flagged for return | Must | **Done** |
| INV-12 | Calibration: identify, send, track, record results | Must | **Done** |
| INV-13 | Lock serialised equipment once calibration expires | Must | **Done** — derived, never a stored flag |
| INV-14 | Plant/site, storage locations, zones, bins by material type | Must | **Done** — store kinds, zones, bins, adopted a store at a time |
| INV-15 | Internal movements and transfers without changing ownership | Must | **Done** — a transfer posts nothing |
| INV-16 | Material Return Note; reusable or scrap | Must | **Done** — numbered note, per-line condition |
| INV-17 | Minimum stock and calibration alerts | Must | **Done** |
| INV-18 | Cycle counts and physical stock audits | Should | Partly — adjustments exist |
| INV-19 | Maintenance work orders for power tools | Should | Not started |
| INV-20 | Vendor self-service registration with compliance checks | Should | Not started |
| INV-21 | Vendor rating: OTIF, defect rate, price, responsiveness | Should | **Done** — derived from what happened, never typed in |
| INV-22 | Vendor portal for RFQ response and order tracking | Could | Not started |

### CRM, Sales and Estimation (§6.4)

Taken from the approved BRD rather than summarised. Eleven of eighteen are Must.

| Ref | Requirement | Priority | State |
|---|---|---|---|
| CRM-01 | Lead capture, segmentation, qualification scoring, interaction history | Must | **Done** — scoring counts what is known, never typed |
| CRM-02 | Pipeline with stage tracking, probability weighting, competitor intelligence | Must | **Done** — probability from the stage, never per deal |
| CRM-03 | Tender / bid logging | Should | Not started |
| CRM-04 | Marketing campaigns, event tracking, ROI | Could | Not started |
| CRM-05 | Bill of Quantities and material takeoff | Must | **Done** — takeoff carries its own wastage |
| CRM-06 | Cost build-up: labour rates, machine hours, indirects | Must | **Done** — no rate can be typed; overhead before margin |
| CRM-07 | Bidding units: per tonne, metre, piece or lump sum | Must | **Done** — a lump sum carries no quantity |
| CRM-08 | Material supply models: FOC and turnkey | Should | Not started |
| CRM-09 | Subcontractor bidding and comparison within the estimate | Should | Not started |
| CRM-10 | Attach ITP, NDT, hydrotest and mill certificates | Should | Not started |
| CRM-11 | Enquiry logged as a lead with defined data fields | Must | **Done** |
| CRM-12 | Site visit recorded, report attached, status shown | Must | **Done** — status derived from the report existing |
| CRM-13 | Estimation engineer prepares a quotation from the report | Must | **Done** — priced from the estimate, no box to type one |
| CRM-14 | Quotation routed to management for approval | Must | **Done** — through the existing approval engine |
| CRM-15 | On approval, issue the quotation as a PDF by email | Must | **Done** — sends through the client's own mail server, configured in Settings |
| CRM-16 | Revisions with full version history | Should | **Done** — a revision supersedes, never edits |
| CRM-17 | Capture the customer PO, hand over to Projects and Finance | Must | **Done** — the job takes THEIR figure, budgeted from the estimate |
| CRM-18 | Markup rules, margin analysis, multi-currency, discount matrices | Should | Not started — multi-currency is the phase-1 item below |

Built in three slices: the lead and the pipeline (done), the estimate (done),
the quotation (done).

**Email now sends for real.** Settings → Email holds the mail server per
company — host, port, security, the mailbox it signs in as, and the address it
sends from — with a Microsoft 365 preset that fills in the settings people
most often get wrong. Quotations go out from the Issue dialog, with recipients
ticked from the customer's own contacts rather than typed.

Three rules hold it up:

- **The password is written and never read back.** It is encrypted at rest
  (`lib/secrets.ts`), stripped out of any error a mail server returns, and the
  settings shape handed to a screen has no password field at all.
- **A refused send does not mark the quotation issued.** Otherwise a company
  waits three weeks for an answer to something that never left the building.
- **The log says "Accepted", never "Delivered."** That is the strongest honest
  claim a sending system can make.

Recording a send made by hand still works, because a client with no mail
server configured still issues quotations.

**The quotation rules, so they are not lost:** the price comes from the
estimate and there is no box to type one; nothing reaches a customer before
management has signed it; an issued quotation is revised rather than edited,
because the customer is holding a piece of paper; and the job is created at
what the customer ORDERED, not what was quoted — customers round, trim scope
and agree discounts on the phone, and taking the quoted figure makes every
margin report on that contract wrong from the first day.

**The estimating rules, so they are not lost:** margin is not markup and both
are shown wherever either appears; overheads go on the direct cost *before* the
margin, or they come straight back out of the profit; no rate is ever typed,
only built up from material, labour hours, plant hours and subcontract; and
wastage lives on each takeoff line because it differs by material.

---

## How phase 2 touches the accounts

Only one module posts, and only for stock. `recordMovement()` in
`lib/stock-posting.ts` calls `postVoucher()`; nothing else in phase 2 reaches
the ledger at all.

| Event | Posts |
|---|---|
| Goods receipt | Dr inventory / Cr goods received not invoiced |
| Issue to a job | Dr site materials, tagged to the job / Cr inventory |
| Reusable return, adjustments | the same pair, reversed as appropriate |
| Transfer between stores | nothing — it changes where stock is, not what is owned |
| Scrap return | nothing — the job already has the cost |
| Purchase order, RFQ, award | nothing — a commitment is not a transaction |
| Equipment, bins, vendor rating, enquiries | nothing |

Accounts are named by **role** rather than code (`inventory`,
`goodsReceivedNotInvoiced`, `materialCost`), so a customer with their own chart
remaps in settings instead of editing code. Nothing bypasses `postVoucher`, so
the period lock, the balance check and the numbering apply to stock exactly as
they do to a manual journal.

CRM posts nothing either. The accounting link arrives at CRM-17, when a won
enquiry becomes a job carrying its contract value — master data, not a voucher.
Revenue reaches the books when invoices are raised against that job, which is
phase-1 Finance already.

---

## 1. Procurement and stores — **in progress**

Material is the largest cost on a contract after labour, and today it only
reaches a job if somebody remembers to tag a supplier invoice by hand. There is
no record of what is on the shelf, what was ordered, or what arrived.

The approval engine already carries a seeded Purchase Order route with nothing
raising one, and supplier advances already exist and connect straight in.

Built in slices, each usable on its own:

- **1a. Stock foundation.** Item master, stores, the movement ledger, and
  weighted-average valuation. Balances derived from movements, never stored.
- **1b. Receiving and issuing.** Goods receipt, issue to a job, returns and
  adjustments, each posting through `postVoucher` like every other module.
  This is the slice that finally puts material cost on a job automatically.
- **1c. Purchase orders.** Material request from site, purchase order through
  the existing approval engine, receipt against the order, and three-way
  matching of order, receipt and supplier invoice.

New account roles needed: inventory (1200 exists), goods received not invoiced,
and site materials. Roles rather than codes, like every other module, so a
customer with their own chart remaps rather than edits code.

## 2. Multi-currency

The largest remaining accounting finding. Instruments and spares are bought in
USD and EUR routinely; today the conversion happens on a calculator outside the
system and only the dirham result is entered, so the exchange difference is
invisible.

Needs a rate on each transaction, a snapshot of the rate used, revaluation of
open balances at period end, and the exchange difference posted rather than
absorbed. Touches existing Finance code rather than adding a module, so it
changes phase-1 behaviour when it merges and wants care.

## 3. Applying a receipt to a specific invoice

Settlement is always oldest-first. When a customer pays one certificate and
disputes another, there is no way to say so, and the ageing then describes a
situation that is not happening.

## 4. Accruals that reverse themselves

A month-end accrual has to be reversed by hand at the start of the next month.
Somebody has to remember, and eventually somebody does not.

## 5. The remaining modules

Empty shells today, in the order they earn their place for a contractor:

- **Projects** — programme, milestones, progress entered by the engineer rather
  than derived from cost. Would give the work in progress report a second
  opinion on completeness.
- **CRM and estimation** — enquiry, quotation, and converting a won quote into a
  job with its contract value and budget already filled in. Fills the gap
  before a contract exists, where everything currently starts from a job
  somebody typed by hand.
- **HSE** — incidents, toolbox talks, permits, and the statutory registers.

## 6. Remaining security audit findings

Four minor items were raised in the original security audit and numbered MIN-4,
MIN-5, MIN-6 and MIN-9. MIN-7, authentication logging, was built in phase 1.

**Their content is not recorded anywhere in this repository.** It needs to be
re-shared before any of them can be worked on, and this note exists so the gap
is visible rather than quietly forgotten.

---

## Found in phase 2, belongs in phase 1

### Voucher numbering stops for the year once a voucher is deleted

`postVoucher` guessed the next voucher number from a **count** of vouchers in
the financial year. That assumes the series is dense and that every row counted
carries the same prefix. Neither holds:

- delete one voucher — a mistake put right, a reversal removed — and `count + 1`
  lands on a number somebody already has;
- a `voucherType` missing from `VOUCHER_PREFIX` falls back to the `JV` prefix
  while still being counted as its own type, so two series share one prefix.

The retry loop then re-read the same count, rebuilt the same reference and
collided again, twenty-five times, before telling one person at a quiet desk
that too many people were posting at once. It was not a slow path: **that
company could not post again for the rest of the financial year.**

Fixed here by taking the highest number already issued in the series rather
than a count, and by never re-offering a number the loop has already been
refused. Covered by `test-posting.mjs`, which fails in three places with the
old code restored.

**This is live phase-1 code and the fix has to reach `main`.** It touches no
schema, so it is a plain code change with no migration.

### The administrator password is written into the deploy logs on every boot

Found on 16 September 2026, while writing the UAT instructions — by reading what
a first boot would print.

The seed runs on every deploy, and its last line was:

```js
console.log("Login:  admin@wandb.ae  /  " + ADMIN_PASSWORD);
```

That prints the value of `ADMIN_PASSWORD` into Railway's deploy logs each time,
including when it was set deliberately. Anybody who can read the project's logs
can read it, and so can anybody a log has ever been pasted to. It is the other
half of audit finding **MAJ-2** — the login page stopped showing the password,
the logs never did. `main` has the identical line.

A second problem sat beside it: with `ADMIN_PASSWORD` unset, a new random password
is generated on every boot, but an existing administrator is never updated. So
every restart announced a password that was not the administrator's and told the
reader to sign in with it.

Fixed in phase 2: the password is printed only outside production, and the
generated one only by the boot that actually created the administrator. Proved
by running the seed as production would against a throwaway database, twice —
the old seed printed the password, the new one does not — and pinned in
`test-security.mjs`, which fails with the old line restored.

**This is live phase-1 code and the fix has to reach `main`**, authored from the
`main` worktree. No schema change.

What it means for the live system today: the value in production's
`ADMIN_PASSWORD` variable is in its deploy logs. If `admin@wandb.ae` was changed
in the app after first sign-in, the current password was never printed — only the
original one. Either way, do not reuse that original value anywhere.

---

## Not code — for Bibin, on the live system

These need doing in production and no amount of development replaces them.

- Mark every bank and petty cash account with control type **Cash or bank**.
  The cash flow forecast opens short without it, and the advances register
  refuses to record anything at all.
- Set payday, the workforce mix target, and the production administrator
  password.
- Confirm whether employees **EMP-0006** and **EMP-0007** are the same person.
- Check that `admin@wandb.ae` has been changed in the app since first sign-in.
  The original value set in `ADMIN_PASSWORD` is in the deploy logs (see *The
  administrator password is written into the deploy logs* above).

---

## How this branch works

Two worktrees, one repository, and two Railway environments.

| | Folder | Branch | Port | Deploys to |
|---|---|---|---|---|
| Production | `C:\Bibin\wb-erp` | `main` | 3000 | **WB ERP production** — the client's live system |
| UAT | *(no folder)* | `uat` | — | **WB ERP UAT** — the client's testers, test data only |
| Phase 2 | `C:\Bibin\wb-erp-phase2` | `phase-2` | 3001 | Nothing directly |

Work reaches the client in two steps. Phase 2 is pushed to `uat`
(`git push origin phase-2:uat`) when it is ready to be tested; once the client
signs off, `main` is fast-forwarded to `uat`, which refuses if production has
anything UAT never tested. `phase-2` itself keeps no upstream, so a bare
`git push` from this folder fails rather than going anywhere.

The full procedure — setup, promotion checklist, rollback and hotfixes — is in
**DEPLOY.md, *UAT and production***.

As of 16 September 2026 the `uat` branch and the UAT project do not exist yet;
DEPLOY.md's one-time setup creates them.

A phase-1 bug is fixed from the `main` worktree, never from this one. That
matters most for migrations: the authoring script diffs against a snapshot
committed alongside them, and a migration written from this tree would carry
phase-2 tables into production.

---

## Test data for a UAT run

```bash
npm run db:demo          # build it
npm run db:demo:clean    # take it all out again
```

Around 460 rows across everything phase 2 added: stores and bins, 24 items,
suppliers and customers with named contacts, four months of receipts, issues,
transfers and count adjustments, material requests and purchase orders at every
status, RFQs with competing supplier quotes, plant with calibration in all three
states, returns from site, fourteen enquiries walked up the pipeline one stage at
a time, estimates with take-offs behind the material figures, and quotations from
draft through to a won job.

Two things about it are deliberate.

**It goes through the same libraries the screens do** — `recordMovement`,
`createLead`, `saveLine`, `createQuotation` — rather than writing rows into the
tables. Data inserted behind the rules looks right in a list and is wrong the
moment anybody opens it. Driving the real path means the trial balance, the job
cost report and the pipeline agree with each other: the run above leaves the
books balancing to the cent and no item showing a negative balance. It also means
the script exercises those paths every time, so it is a smoke test that happens
to leave something behind.

**It is marked and removable.** Every master it creates is coded `T-…` and every
document carries `[test data]` in its notes. `--clean` takes all of it out,
including the vouchers the postings raised, and runs first on every build so a
second run replaces the data rather than colliding with it. Test data that cannot
be told from the real thing is a liability — somebody invoices against it
eventually.

It refuses production and unnamed live Railway databases, the same way the
rehearsal scripts do. Use `--company=WBE` to choose which books it lands in;
by default it picks the company with the most jobs, because material cost is
worth far more sitting against real contracts.
