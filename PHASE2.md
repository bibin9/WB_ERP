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
| INV-05 | Convert MR to PO; RFQ to vendors | Must | PO **done**; RFQ not started |
| INV-06 | Vendor selection on price, lead time, past performance, min three | Must | Not started |
| INV-07 | Repeat purchases without re-bidding | Should | Not started |
| INV-08 | PO approval PM → OM → Director → MD | Must | **Done**, using the seeded route |
| INV-09 | Bid comparison sheets, PO from the chosen quotation | Should | Not started |
| INV-10 | Goods receipt on delivery | Must | **Done** |
| INV-11 | QA/QC inspection; accepted stored, rejected flagged for return | Must | **Done** |
| INV-12 | Calibration: identify, send, track, record results | Must | **Done** |
| INV-13 | Lock serialised equipment once calibration expires | Must | **Done** — derived, never a stored flag |
| INV-14 | Plant/site, storage locations, zones, bins by material type | Must | Partly — stores exist, no zones or bins |
| INV-15 | Internal movements and transfers without changing ownership | Must | **Done** — a transfer posts nothing |
| INV-16 | Material Return Note; reusable or scrap | Must | **Done** — numbered note, per-line condition |
| INV-17 | Minimum stock and calibration alerts | Must | **Done** |
| INV-18 | Cycle counts and physical stock audits | Should | Partly — adjustments exist |
| INV-19 | Maintenance work orders for power tools | Should | Not started |
| INV-20 | Vendor self-service registration with compliance checks | Should | Not started |
| INV-21 | Vendor rating: OTIF, defect rate, price, responsiveness | Should | Not started |
| INV-22 | Vendor portal for RFQ response and order tracking | Could | Not started |

### CRM, Sales and Estimation (§6.4)

Not started. Eleven of its eighteen requirements are Must: lead capture and
pipeline (CRM-01, 02), bill of quantities and takeoff (CRM-05), cost build-up
(CRM-06), bidding units per tonne, metre, piece or lump sum (CRM-07), and the
enquiry → site visit → quotation → approval → customer PO workflow
(CRM-11 to 15, 17).

CRM-18 wants multi-currency quotations, which is the same multi-currency work
already on this list from phase 1.

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

---

## Not code — for Bibin, on the live system

These need doing in production and no amount of development replaces them.

- Mark every bank and petty cash account with control type **Cash or bank**.
  The cash flow forecast opens short without it, and the advances register
  refuses to record anything at all.
- Set payday, the workforce mix target, and the production administrator
  password.
- Confirm whether employees **EMP-0006** and **EMP-0007** are the same person.

---

## How this branch works

Two worktrees, one repository.

| | Folder | Branch | Port | Reaches the client |
|---|---|---|---|---|
| Phase 1 | `C:\Bibin\wb-erp` | `main` | 3000 | Yes, on push |
| Phase 2 | `C:\Bibin\wb-erp-phase2` | `phase-2` | 3001 | No |

Railway is connected to `main` only, with auto-deploy on push, so a phase-2
push cannot reach production.

A phase-1 bug is fixed from the `main` worktree, never from this one. That
matters most for migrations: the authoring script diffs against a snapshot
committed alongside them, and a migration written from this tree would carry
phase-2 tables into production.
