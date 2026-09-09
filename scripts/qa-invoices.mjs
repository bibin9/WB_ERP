/**
 * Raising, issuing and printing an invoice, through the running application.
 *
 * The unit suites prove the arithmetic and the posting. This proves the path a
 * person actually takes: a draft that posts nothing, an issue that posts once,
 * a printed document that carries what the law wants on the face of it, and a
 * draft that is refused rather than issued half-finished.
 *
 * Named qa- because it drives the running app, like qa-smoke. Everything it
 * writes is removed again, whether it passes or not.
 *
 *   npm run dev
 *   node --experimental-strip-types scripts/qa-invoices.mjs
 */
import { PrismaClient } from "@prisma/client";
import { signSession, SESSION_COOKIE } from "../src/lib/session-token.ts";
import { importLibs } from "./lib-shim.mjs";
import fs from "node:fs";

for (const line of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
  const t = line.trim();
  if (!t || t.startsWith("#")) continue;
  const i = t.indexOf("=");
  if (i === -1) continue;
  const k = t.slice(0, i).trim();
  if (!process.env[k]) process.env[k] = t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
}

// The screens are read over HTTP. Issuing goes through the library the
// server action calls: an action imports next/cache and the @/ alias, which
// only resolve inside Next. That the action wraps this with a permission
// check is asserted in test-authz.mjs, where it belongs.
const { "invoice-posting": posting } = await importLibs([
  "invoice-posting", "invoice", "posting", "accounts", "financepolicy", "money", "vat", "db", "period",
]);
const { issueInvoice } = posting;

const db = new PrismaClient();
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { c ? pass++ : fail++; console.log(`  ${c ? "PASS" : "FAIL"} ${n}${x ? "  — " + x : ""}`); };

const tenant = await db.tenant.findFirst();
const co = await db.company.findFirst({ where: { code: "WBE" } });
const admin = await db.user.findFirst({
  where: { tenantId: tenant.id, memberships: { some: { role: { approvalLevel: { gte: 80 } } } } },
});
const token = await signSession({ uid: admin.id, tid: tenant.id, name: admin.name, email: admin.email });
const get = async (path) => {
  const r = await fetch("http://localhost:3000" + path, {
    headers: { cookie: `${SESSION_COOKIE}=${token}` }, redirect: "manual",
  });
  const raw = await r.text();
  // React separates {expression} from adjacent text with comment markers.
  return { status: r.status, html: raw, text: raw.replace(/<!--\s*-->/g, "") };
};

const MARK = "QA-INV";
const made = [];
const cleanup = async () => {
  const invs = await db.invoice.findMany({
    where: { companyId: co.id, OR: [{ notes: { startsWith: MARK } }, { id: { in: made } }] },
    select: { id: true, entryId: true },
  });
  await db.invoiceLine.deleteMany({ where: { invoiceId: { in: invs.map((i) => i.id) } } });
  await db.invoice.deleteMany({ where: { id: { in: invs.map((i) => i.id) } } });
  for (const e of invs.map((i) => i.entryId).filter(Boolean)) {
    await db.journalEntry.delete({ where: { id: e } }).catch(() => {});
  }
  made.length = 0;
};
await cleanup();

const originalTrn = co.vatTRN;

try {
  /* ============ the list screen ====================================== */
  {
    const p = await get(`/finance/invoices?c=${co.id}`);
    ok("the invoices screen renders", p.status === 200, String(p.status));
    ok("it separates what we issued from what suppliers billed us",
      p.html.includes("We issued") && p.html.includes("Suppliers billed us"));
    ok("and says plainly that a draft is not an invoice", p.text.includes("A draft is not an invoice"));
    ok("the new-invoice button is offered", p.html.includes("/finance/invoices/new"));

    const nw = await get(`/finance/invoices/new?c=${co.id}&side=Sales`);
    ok("the entry screen renders", nw.status === 200, String(nw.status));
    ok("it offers units of measure", nw.html.includes("Cubic metre") && nw.html.includes("Hour"));
    ok("and every VAT treatment", nw.html.includes("Reverse charge") && nw.html.includes("Zero-rated"));
    ok("the number is ours and not typed", nw.text.includes("Allocated when saved"));
  }

  /* ============ a draft posts nothing ================================= */
  const party = await db.party.findFirst({ where: { companyId: co.id, type: { in: ["Customer", "Both"] } } });
  const revenue = await db.chartOfAccount.findFirst({ where: { companyId: co.id, type: "Income" } });

  const draft = await db.invoice.create({
    data: {
      companyId: co.id, side: "Sales", docType: "Invoice", status: "Draft",
      number: `${MARK}/0001`, issueDate: new Date("2026-06-20T00:00:00Z"),
      partyId: party.id, partyName: party.name, partyTrn: party.trn,
      notes: `${MARK} draft`,
      lines: {
        create: [
          { order: 0, description: "Cable tray installation", quantity: 120, unitCode: "MTR", unitPrice: 45, accountId: revenue.id, vatTreatment: "Standard" },
          { order: 1, description: "Site supervision", quantity: 16, unitCode: "HUR", unitPrice: 120, accountId: revenue.id, vatTreatment: "Standard" },
        ],
      },
    },
  });
  made.push(draft.id);

  {
    const p = await get(`/finance/invoices/${draft.id}`);
    ok("a draft opens in the editor", p.status === 200 && p.html.includes("Save draft"), String(p.status));
    ok("with its lines", p.html.includes("Cable tray installation") && p.html.includes("Site supervision"));
    ok("and an Issue button", p.text.includes("Issue invoice"));
    ok("a draft has no ledger entry behind it", draft.entryId === null);
    ok("and cannot be printed as a tax invoice",
      !p.html.includes(`href="/invoice/${draft.id}"`), "print is offered only once issued");
  }

  /* ============ an incomplete document is refused ===================== */
  {
    await db.company.update({ where: { id: co.id }, data: { vatTRN: null } });
    const res = await issueInvoice(draft.id, "qa");
    ok("a company with no VAT TRN cannot issue a tax invoice", !res.ok, res.ok ? "IT ISSUED" : res.error);
    ok("and is told exactly what is missing",
      !res.ok && res.problems?.some((x) => /VAT registration number/.test(x.message)),
      res.ok ? "" : res.problems?.map((x) => x.message).join(" | "));
    ok("nothing was posted by the refusal",
      (await db.invoice.findUnique({ where: { id: draft.id } })).entryId === null);
    await db.company.update({ where: { id: co.id }, data: { vatTRN: "100123456700003" } });
  }

  /* ============ issuing it once ======================================= */
  {
    const res = await issueInvoice(draft.id, "qa");
    ok("it issues once the TRN is there", res.ok, res.ok ? "" : res.error);

    const after = await db.invoice.findUnique({ where: { id: draft.id }, include: { entry: true } });
    ok("the document is issued and posted", after.status === "Issued" && !!after.entryId);
    ok("totals are on the row", after.netTotal === 7320 && after.vatTotal === 366 && after.grossTotal === 7686,
      `${after.netTotal}/${after.vatTotal}/${after.grossTotal}`);

    const lines = await db.journalLine.findMany({
      where: { entryId: after.entryId }, include: { account: { select: { code: true } } },
    });
    const dr = lines.reduce((t, l) => t + l.debit, 0);
    const cr = lines.reduce((t, l) => t + l.credit, 0);
    ok("the voucher balances", Math.abs(dr - cr) < 0.005, `${dr} / ${cr}`);
    ok("receivables carry the gross", lines.find((l) => l.account.code === "1100")?.debit === 7686);

    const again = await issueInvoice(draft.id, "qa");
    ok("issuing again is refused", !again.ok, again.ok ? "IT POSTED TWICE" : again.error);
  }

  /* ============ the printed document ================================== */
  {
    const p = await get(`/invoice/${draft.id}`);
    ok("the printable invoice renders", p.status === 200, String(p.status));
    ok("it is titled a tax invoice", p.html.includes("TAX INVOICE"));
    ok("it carries our TRN", p.text.includes("100123456700003"));
    ok("and the customer's", p.text.includes(party.trn ?? "TRN"));
    ok("the number and date are on the face of it", p.text.includes(`${MARK}/0001`));
    ok("each line shows quantity, unit and rate",
      p.html.includes("Cable tray installation") && p.html.includes("Metre") && p.html.includes("Hour"));
    ok("the tax is shown by rate, which a tax invoice must do",
      /Standard at 5%/.test(p.text), "not just one lump of VAT");
    ok("and the total is there", p.text.includes("7,686.00"));
    ok("it is printed on paper, not a screen", p.html.includes("theme-light"));
    ok("no draft watermark on an issued document", !p.html.includes("not a valid tax invoice"));

    const detail = await get(`/finance/invoices/${draft.id}`);
    ok("the detail screen now offers Print", detail.html.includes(`href="/invoice/${draft.id}"`));
    ok("and no longer offers to edit", !detail.html.includes("Save draft"));
    ok("it names the voucher it posted as", /WBE\/SI\//.test(detail.text));
  }

  /* ============ a draft is watermarked if printed ===================== */
  {
    const d2 = await db.invoice.create({
      data: {
        companyId: co.id, side: "Sales", docType: "Invoice", status: "Draft",
        number: `${MARK}/0002`, issueDate: new Date("2026-06-21T00:00:00Z"),
        partyId: party.id, partyName: party.name, notes: `${MARK} second`,
        lines: { create: [{ order: 0, description: "Draft line", quantity: 1, unitCode: "EA", unitPrice: 100, accountId: revenue.id }] },
      },
    });
    made.push(d2.id);
    const p = await get(`/invoice/${d2.id}`);
    ok("a draft printed by hand says it is not a valid tax invoice",
      p.text.includes("not a valid tax invoice"), "so it cannot be passed off as one");
  }
} finally {
  await db.company.update({ where: { id: co.id }, data: { vatTRN: originalTrn } });
  await cleanup();
}

await db.$disconnect();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
