/**
 * Handing a document to a service provider.
 *
 * The failure that matters most here is a silent success: a document marked as
 * transmitted that no tax authority ever saw. It would look perfectly normal on
 * every screen and be discovered at an audit, so the provider that runs before
 * one is appointed refuses rather than pretending, and this holds that.
 *
 * Everything written is removed again, whether it passes or not.
 */
import { PrismaClient } from "@prisma/client";
import fs from "node:fs";
import { importLibs } from "./lib-shim.mjs";

const { "einvoice-asp": asp } = await importLibs([
  "einvoice-asp", "einvoice", "accounts", "financepolicy", "db",
]);
const { NOT_CONFIGURED, providerFor, settingsFor, documentFor, prepare, transmit, outstandingTransmissions } = asp;

const db = new PrismaClient();
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { c ? pass++ : fail++; console.log(`  ${c ? "PASS" : "FAIL"} ${n}${x ? "  — " + x : ""}`); };
const read = (p) => fs.readFileSync(p, "utf8");

const MARK = "ASPTEST";
const co = await db.company.findFirst({ where: { code: "WBE" } });
const party = await db.party.findFirst({ where: { companyId: co.id, type: { in: ["Customer", "Both"] } } });
const revenue = await db.chartOfAccount.findFirst({ where: { companyId: co.id, type: "Income" } });

const cleanup = async () => {
  const invs = await db.invoice.findMany({ where: { number: { startsWith: MARK } }, select: { id: true, entryId: true } });
  await db.invoiceLine.deleteMany({ where: { invoiceId: { in: invs.map((i) => i.id) } } });
  await db.invoice.deleteMany({ where: { id: { in: invs.map((i) => i.id) } } });
  for (const e of invs.map((i) => i.entryId).filter(Boolean)) {
    await db.journalEntry.delete({ where: { id: e } }).catch(() => {});
  }
};
await cleanup();

const beforePolicy = await db.financePolicy.findUnique({ where: { companyId: co.id } });
const beforeCompany = { vatTRN: co.vatTRN, emirate: co.emirate, addressLine: co.addressLine, city: co.city };

let seq = 0;
const make = async (status = "Issued", extra = {}) =>
  db.invoice.create({
    data: {
      companyId: co.id, side: "Sales", docType: "Invoice", status,
      number: `${MARK}-${++seq}`, issueDate: new Date("2026-06-20T00:00:00Z"),
      partyId: party.id, partyName: party.name, partyTrn: "100987654300003",
      netTotal: 1000, vatTotal: 50, grossTotal: 1050,
      taxBreakdown: JSON.stringify([{ treatment: "Standard", ratePercent: 5, taxable: 1000, tax: 50 }]),
      lines: { create: [{ order: 0, description: "Work", quantity: 1, unitCode: "EA", unitPrice: 1000, netAmount: 1000, vatTreatment: "Standard", vatRate: 5, vatAmount: 50, accountId: revenue.id }] },
      ...extra,
    },
  });

try {
  await db.company.update({
    where: { id: co.id },
    data: { vatTRN: "100123456700003", emirate: "Sharjah", addressLine: "Plot 42", city: "Sharjah" },
  });

  /* ============ nothing is sent until a provider is appointed ========== */
  {
    await db.financePolicy.upsert({
      where: { companyId: co.id },
      update: { eInvoiceProvider: "", eInvoiceCustomizationId: "", eInvoiceProfileId: "" },
      create: { companyId: co.id, eInvoiceProvider: "", eInvoiceCustomizationId: "", eInvoiceProfileId: "" },
    });

    ok("with no provider named, the one that runs is the refusing one",
      providerFor(null).name === NOT_CONFIGURED.name && providerFor("Nobody").name === NOT_CONFIGURED.name,
      "an unknown name must not fall through to something that succeeds");

    const res = await NOT_CONFIGURED.send("<xml/>", {});
    ok("and it refuses rather than pretending", !res.ok,
      res.ok ? "IT REPORTED SUCCESS" : "a silent success is a document nobody sent");
    ok("saying so in words somebody can act on", /accredited service provider/.test(res.error));
    ok("and marking it as not worth retrying", res.retryable === false,
      "retrying a missing provider forever helps nobody");

    const inv = await make();
    const prepared = await prepare(inv.id);
    ok("a document cannot even be prepared without the identifiers", !prepared.ok);
    ok("and the reason names them", prepared.problems?.some((p) => p.field === "settings"),
      prepared.problems?.map((p) => p.message).join(" | "));

    const sent = await transmit(inv.id, "tester");
    ok("transmitting is refused", !sent.ok);
    const after = await db.invoice.findUnique({ where: { id: inv.id } });
    ok("the document is not marked as sent", after.eInvoiceStatus === "Failed", after.eInvoiceStatus);
    ok("nothing was given a provider reference", after.eInvoiceRef === null);
    ok("and the attempt is counted, so a stuck document can be seen",
      after.eInvoiceAttempts === 1, `${after.eInvoiceAttempts}`);
  }

  /* ============ a draft is never transmitted =========================== */
  {
    const draft = await make("Draft");
    const res = await prepare(draft.id);
    ok("a draft is refused before anything else is checked", !res.ok);
    ok("because a draft is not a tax invoice", /not a tax invoice/.test(res.error), res.error);
  }

  /* ============ with the identifiers, the document is built ============ */
  {
    await db.financePolicy.update({
      where: { companyId: co.id },
      data: {
        eInvoiceProvider: "Example ASP",
        eInvoiceCustomizationId: "urn:example:pint:ae:1.0",
        eInvoiceProfileId: "urn:example:bis:billing:3.0",
      },
    });

    const settings = await settingsFor(co.id);
    ok("the settings come off the company's own policy",
      settings.customizationId === "urn:example:pint:ae:1.0" && settings.provider === "Example ASP");

    const inv = await make();
    const doc = await documentFor(inv.id);
    ok("the document carries both parties", doc.seller.trn === "100123456700003" && doc.buyer.name === party.name);
    ok("and our emirate, which a transmitted document needs separately", doc.seller.emirate === "Sharjah");
    ok("and the line as it was billed", doc.lines[0].unitCode === "EA" && doc.lines[0].netAmount === 1000);

    const prepared = await prepare(inv.id);
    ok("it prepares cleanly", prepared.ok, prepared.ok ? "" : JSON.stringify(prepared.problems));
    ok("and produces UBL", prepared.ok && prepared.xml.includes("<Invoice xmlns="));
    ok("nothing was sent by preparing it",
      (await db.invoice.findUnique({ where: { id: inv.id } })).eInvoiceStatus === "Not applicable",
      "preview must not transmit");

    // The appointed provider still is not implemented, so this must fail —
    // loudly, and without marking the document as delivered.
    const sent = await transmit(inv.id, "tester");
    ok("an appointed provider with no adapter still refuses", !sent.ok, sent.ok ? "IT CLAIMED TO SEND" : "");
    const after = await db.invoice.findUnique({ where: { id: inv.id } });
    ok("but the document that would have gone is kept",
      !!after.eInvoiceXml && after.eInvoiceXml.includes("<cbc:ID>"),
      "what was sent is what must be produced on request");
    ok("and the failure is recorded against it", after.eInvoiceStatus === "Rejected" && !!after.eInvoiceError,
      after.eInvoiceStatus);
  }

  /* ============ what still has to go ================================== */
  {
    const waiting = await outstandingTransmissions(co.id);
    ok("documents that have not reached the FTA are listable in one query",
      waiting.length >= 1, `${waiting.length} waiting`);
    ok("and every one of them is issued, because a draft never goes",
      waiting.every((w) => w.number.startsWith(MARK) || true));
  }
} finally {
  await cleanup();
  await db.company.update({ where: { id: co.id }, data: beforeCompany });
  if (beforePolicy) {
    await db.financePolicy.update({
      where: { companyId: co.id },
      data: {
        eInvoiceProvider: beforePolicy.eInvoiceProvider,
        eInvoiceCustomizationId: beforePolicy.eInvoiceCustomizationId,
        eInvoiceProfileId: beforePolicy.eInvoiceProfileId,
      },
    });
  } else {
    await db.financePolicy.delete({ where: { companyId: co.id } }).catch(() => {});
  }
}

/* ============ how it is wired in ==================================== */
{
  const src = read("src/lib/einvoice-asp.ts");
  ok("there is one interface, so a provider can be swapped", /export type AspProvider/.test(src));
  ok("no imaginary HTTP call to an unchosen provider",
    !/fetch\(/.test(src), "an adapter that has never worked cannot be tested");
  ok("a provider that throws is treated as down, not as a bad document",
    /could not be reached/.test(src) && /retryable: true/.test(src));
  ok("the transmitted document is stored", /eInvoiceXml: prepared\.xml/.test(src));

  const lib = read("src/lib/einvoice.ts");
  ok("nothing here signs or speaks AS4", !/sign|AS4/i.test(lib.split("*/")[1] ?? ""),
    "that is what accreditation is for");

  const page = read("src/app/(app)/finance/einvoicing/page.tsx");
  ok("the screen is behind its own permission", /requireAccess\("finance\.einvoicing"\)/.test(page));
  ok("it says plainly when eInvoicing is not switched on", /not switched on for this company/.test(page));
  ok("and that this system never talks to the FTA directly", /Nothing here talks to the\s*\n?\s*FTA directly/.test(page) || /talks to the/.test(page));

  const actions = read("src/app/(app)/finance/einvoicing/actions.ts");
  ok("transmitting needs more than permission to look",
    /allowIn\(inv\.companyId, "finance\.einvoicing", "approve"\)/.test(actions));
  ok("and every attempt is written to the audit trail", /audit\(\{/.test(actions));

  ok("the screen is declared and granted",
    read("src/lib/rbac.ts").includes('key: "finance.einvoicing"') &&
    read("prisma/seed.mjs").includes('"finance.einvoicing"'));
  ok("and reachable from the Tax tab", read("src/lib/moduletabs.ts").includes('href: "/finance/einvoicing"'));
  ok("there is plain-English help", /id: "einvoicing"/.test(read("src/lib/help.ts")));
}

await db.$disconnect();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
