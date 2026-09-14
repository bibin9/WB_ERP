# Phase 2

Everything phase 1 left open, in one place, so none of it is lost between
sessions. Phase 1 is complete and live; nothing here reaches the client until
it is merged to `main` deliberately.

Order is roughly by value to the business, not by effort.

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
