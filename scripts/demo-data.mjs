/**
 * Test data for a UAT run: enough of it, and unmistakably not real.
 *
 * Two rules shape the whole script.
 *
 * The first is that it goes through the same libraries the screens do —
 * `recordMovement`, `createLead`, `saveLine`, `createQuotation` — rather than
 * writing rows straight into the tables. Data inserted behind the rules looks
 * right in a list and is wrong the moment anybody opens it: a stock balance
 * with no voucher behind it, an estimate whose total does not match its lines,
 * a quotation priced at a number nobody built up. Driving the real path means
 * the trial balance, the job cost report and the pipeline all agree with each
 * other, which is the only reason to have test data at all. It also means this
 * script exercises those paths on every run, so it is a smoke test that
 * happens to leave something behind.
 *
 * The second is that everything it creates is marked and removable. Test data
 * that cannot be told from the real thing is a liability — somebody invoices
 * against it eventually. Every master it creates has a `T-` code, every
 * document carries a marker in its notes, and `--clean` takes all of it out
 * again along with the vouchers the postings raised.
 *
 * Refuses production, on the same terms as the rehearsal scripts.
 *
 *   node --experimental-strip-types scripts/demo-data.mjs
 *   node --experimental-strip-types scripts/demo-data.mjs --clean
 */
import { existsSync, readFileSync } from "node:fs";
import { importLibs } from "./lib-shim.mjs";

/* ------------------------------------------------------------------ guards */

function loadEnvFile(file) {
  const out = {};
  if (!existsSync(file)) return out;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    out[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

const fileEnv = loadEnvFile(".env");
const target = process.env.DATABASE_URL || fileEnv.DATABASE_URL || "";
const prodUrl = process.env.PROD_DATABASE_URL || fileEnv.PROD_DATABASE_URL || "";

/**
 * host:port of a database URL, and nothing else.
 *
 * Never the whole string. The check this replaced looked for words like "uat"
 * or "test" anywhere in the URL, which included the password — so a password
 * that happened to contain "uat" walked straight past a guard meant to protect
 * the client's data. And Railway's public connection string never carries the
 * service's name at all, so a correctly named UAT database was refused anyway.
 * A guard that the wrong database can pass and the right one cannot is worse
 * than none.
 */
function hostPort(u) {
  try {
    const x = new URL(u);
    return `${x.hostname}:${x.port || "5432"}`.toLowerCase();
  } catch {
    return "";
  }
}
const isPostgres = /^postgres(ql)?:\/\//i.test(target);
const isLocal = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(hostPort(target).replace(/:\d+$/, ""));

if (isPostgres && prodUrl && hostPort(target) === hostPort(prodUrl)) {
  console.error("\nThat is the production database. Test data does not go there. Refusing.\n");
  process.exit(1);
}

// Any database that is not on this machine gets test data only when the person
// running this has typed which one they mean. Nothing about the URL can stand
// in for that: names are not in Railway's URLs, and passwords are not evidence.
if (isPostgres && !isLocal) {
  const confirmed = String(process.env.TEST_DATA_CONFIRM_HOST ?? "").trim().toLowerCase();
  if (!confirmed) {
    console.error(
      `\nThis would write test data into the database at ${hostPort(target)}.\n` +
        "Say that is the one you mean by setting TEST_DATA_CONFIRM_HOST to exactly that host and port.\n" +
        "Use npm run db:demo:uat, which asks for it.\n",
    );
    process.exit(1);
  }
  if (confirmed !== hostPort(target)) {
    console.error(
      `\nYou confirmed ${confirmed}, but the database this is pointed at is ${hostPort(target)}. Refusing.\n`,
    );
    process.exit(1);
  }
}

const ONLY_CLEAN = process.argv.includes("--clean");
/** Which company to build in, e.g. --company=WBE. */
const WANT = (process.argv.find((a) => a.startsWith("--company=")) ?? "").split("=")[1] ?? "";

/* ------------------------------------------------------------------- setup */

const libs = await importLibs([
  "db", "stock-posting", "stock", "bins", "lead-posting", "leads",
  "estimate-posting", "estimating", "quote-posting", "quoting", "docnumber",
]);
const { db } = libs["db"];
const { recordMovement, transferStock, inspectReceipt, postReturn } = libs["stock-posting"];
const { createLead, moveStage, logInteraction, recordVisit, submitReport } = libs["lead-posting"];
const { createEstimate, saveLine, saveTakeoff, setBasis, markPriced } = libs["estimate-posting"];
const { createQuotation, submitQuotation, syncQuoteApproval, issueQuotation, acceptQuotation, declineQuotation } =
  libs["quote-posting"];
const { documentStem, nextInSeries } = libs["docnumber"];

/** The marker every document this script writes carries in its notes. */
const MARK = "[test data]";
/** The prefix every master it creates carries in its code. */
const P = "T-";
const BY = "UAT test data";

/**
 * A fixed sequence, so two runs produce the same figures.
 *
 * Random test data makes a defect that depends on a particular number
 * impossible to bring back, and makes two people comparing screens think they
 * are looking at a bug when they are looking at different data.
 */
let seed = 20260915;
const rnd = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 0x100000000;
};
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const between = (lo, hi, dp = 2) => Number((lo + rnd() * (hi - lo)).toFixed(dp));

const TODAY = new Date("2026-09-15T00:00:00Z");
/** An ISO date `days` before today. */
const ago = (days) => new Date(TODAY.getTime() - days * 86400000).toISOString().slice(0, 10);
const on = (days) => new Date(ago(days) + "T00:00:00Z");

const note = (text) => `${text} ${MARK}`;
let made = 0;
const tally = (what, n) => {
  made += n;
  console.log(`   ${String(n).padStart(4)}  ${what}`);
};

/* ------------------------------------------------------------------- clean */

/**
 * Take it all out again, dependants first.
 *
 * The vouchers go too. A stock posting raises a real journal entry, and
 * deleting the movement while leaving the entry behind would leave the ledger
 * carrying value for material that is no longer anywhere — which is a worse
 * state than either having the data or not having it.
 */
async function clean() {
  console.log("\nRemoving test data.\n");

  const marked = { notes: { contains: MARK } };
  const masters = { code: { startsWith: P } };

  /*
   * Anything hanging off a test master counts as test data, marker or not.
   *
   * Using the app creates documents this script never wrote: awarding a test
   * enquiry raises a purchase order whose notes say "Awarded from enquiry ...",
   * and receiving against it writes movements. None of them carry the marker,
   * all of them point at a `T-` supplier, and leaving them behind made the
   * party delete fail on a foreign key with every other table already emptied
   * — a half-cleaned database that needs a human to unpick.
   */
  const orMaster = (...clauses) => ({ OR: [marked, ...clauses] });

  // Movements first, and their vouchers with them.
  const movements = await db.stockMovement.findMany({
    where: { OR: [marked, { item: masters }, { store: masters }] },
    select: { id: true, entryId: true },
  });
  const entryIds = movements.map((m) => m.entryId).filter(Boolean);
  const movementIds = movements.map((m) => m.id);

  await db.materialReturnLine.deleteMany({ where: { OR: [{ movementId: { in: movementIds } }, { return: marked }] } });
  await db.materialReturn.deleteMany({ where: marked });
  await db.stockMovement.deleteMany({ where: { id: { in: movementIds } } });
  if (entryIds.length) {
    await db.journalLine.deleteMany({ where: { entryId: { in: entryIds } } });
    await db.journalEntry.deleteMany({ where: { id: { in: entryIds } } });
  }
  tally("stock movements and their vouchers", movementIds.length);

  // Quotations before estimates, estimates before leads: each points at the one
  // before it, and a quotation also points at the job it won.
  const quoteWhere = orMaster({ party: masters }, { lead: { party: masters } });
  const quotes = await db.quotation.findMany({ where: quoteWhere, select: { id: true, jobId: true, approvalRequestId: true } });
  await db.quotation.updateMany({ where: quoteWhere, data: { supersedesId: null } });
  await db.quotation.deleteMany({ where: { id: { in: quotes.map((q) => q.id) } } });
  const jobIds = quotes.map((q) => q.jobId).filter(Boolean);
  if (jobIds.length) await db.job.deleteMany({ where: { id: { in: jobIds }, code: { startsWith: P } } });
  const approvals = quotes.map((q) => q.approvalRequestId).filter(Boolean);
  if (approvals.length) {
    await db.approvalStep.deleteMany({ where: { requestId: { in: approvals } } });
    await db.approvalRequest.deleteMany({ where: { id: { in: approvals } } });
  }
  tally("quotations", quotes.length);

  const estimateWhere = orMaster({ lead: { party: masters } });
  const estimates = await db.estimate.findMany({ where: estimateWhere, select: { id: true } });
  const lineIds = (
    await db.estimateLine.findMany({ where: { estimateId: { in: estimates.map((e) => e.id) } }, select: { id: true } })
  ).map((l) => l.id);
  await db.takeoffLine.deleteMany({ where: { lineId: { in: lineIds } } });
  await db.estimateLine.deleteMany({ where: { id: { in: lineIds } } });
  await db.estimate.deleteMany({ where: { id: { in: estimates.map((e) => e.id) } } });
  tally("estimates", estimates.length);

  const leads = await db.lead.findMany({ where: orMaster({ party: masters }), select: { id: true } });
  const leadIds = leads.map((l) => l.id);
  await db.leadInteraction.deleteMany({ where: { leadId: { in: leadIds } } });
  await db.siteVisit.deleteMany({ where: { leadId: { in: leadIds } } });
  await db.lead.deleteMany({ where: { id: { in: leadIds } } });
  tally("enquiries", leadIds.length);

  const rfqs = await db.rfq.findMany({
    where: orMaster({ awardedParty: masters }, { quotes: { some: { party: masters } } }),
    select: { id: true },
  });
  const rfqIds = rfqs.map((r) => r.id);
  const quoteIds = (await db.rfqQuote.findMany({ where: { rfqId: { in: rfqIds } }, select: { id: true } })).map((q) => q.id);
  await db.rfqQuoteLine.deleteMany({ where: { quoteId: { in: quoteIds } } });
  await db.rfqQuote.deleteMany({ where: { id: { in: quoteIds } } });
  await db.rfqLine.deleteMany({ where: { rfqId: { in: rfqIds } } });
  await db.rfq.deleteMany({ where: { id: { in: rfqIds } } });
  tally("requests for quotation", rfqIds.length);

  const orders = await db.purchaseOrder.findMany({
    where: orMaster({ party: masters }, { store: masters }),
    select: { id: true },
  });
  const orderIds = orders.map((o) => o.id);
  // Movements pointing at these lines were cleared above, but a receipt made
  // by hand against a surviving line would still hold them.
  const orderLineIds = (
    await db.purchaseOrderLine.findMany({ where: { orderId: { in: orderIds } }, select: { id: true } })
  ).map((l) => l.id);
  await db.stockMovement.updateMany({
    where: { purchaseOrderLineId: { in: orderLineIds } },
    data: { purchaseOrderLineId: null },
  });
  await db.purchaseOrderLine.deleteMany({ where: { orderId: { in: orderIds } } });
  await db.purchaseOrder.deleteMany({ where: { id: { in: orderIds } } });
  tally("purchase orders", orders.length);

  const requests = await db.materialRequest.findMany({
    where: orMaster({ store: masters }),
    select: { id: true },
  });
  await db.materialRequestLine.deleteMany({ where: { requestId: { in: requests.map((r) => r.id) } } });
  await db.materialRequest.deleteMany({ where: { id: { in: requests.map((r) => r.id) } } });
  tally("material requests", requests.length);

  const kit = await db.equipment.findMany({
    where: { OR: [marked, { serialNo: { startsWith: P } }, { store: masters }] },
    select: { id: true },
  });
  await db.calibrationRecord.deleteMany({ where: { equipmentId: { in: kit.map((e) => e.id) } } });
  await db.equipment.deleteMany({ where: { id: { in: kit.map((e) => e.id) } } });
  tally("equipment", kit.length);

  const binsGone = await db.storageBin.deleteMany({ where: { store: masters } });
  const storesGone = await db.store.deleteMany({ where: masters });
  const itemsGone = await db.item.deleteMany({ where: masters });
  tally("bins, stores and items", binsGone.count + storesGone.count + itemsGone.count);

  const contactsGone = await db.partyContact.deleteMany({ where: { party: masters } });
  let partiesGone = { count: 0 };
  try {
    partiesGone = await db.party.deleteMany({ where: masters });
  } catch {
    // A bare "foreign key constraint violated" leaves somebody guessing which
    // of thirty tables is holding on. Name it.
    const ids = (await db.party.findMany({ where: masters, select: { id: true } })).map((p) => p.id);
    const holders = [];
    for (const [label, n] of [
      ["purchase orders", await db.purchaseOrder.count({ where: { partyId: { in: ids } } })],
      ["stock movements", await db.stockMovement.count({ where: { partyId: { in: ids } } })],
      ["enquiry quotes", await db.rfqQuote.count({ where: { partyId: { in: ids } } })],
      ["enquiries awarded", await db.rfq.count({ where: { awardedPartyId: { in: ids } } })],
      ["leads", await db.lead.count({ where: { partyId: { in: ids } } })],
      ["quotations", await db.quotation.count({ where: { partyId: { in: ids } } })],
      ["invoices", await db.invoice.count({ where: { partyId: { in: ids } } })],
    ]) {
      if (n > 0) holders.push(`${n} ${label}`);
    }
    throw new Error(
      "Could not remove the test suppliers and customers because rows still point at them: " +
        (holders.join(", ") || "something not listed here") +
        ". Those were almost certainly created by using the app rather than by this script.",
    );
  }
  tally("suppliers, customers and their contacts", contactsGone.count + partiesGone.count);
}

/* ------------------------------------------------------------------- build */

/** The next number in a register, using the same rule the screens use. */
async function nextNumber(table, companyCode, prefix) {
  const stem = documentStem(companyCode, prefix, TODAY);
  const last = await db[table].findFirst({
    where: { number: { startsWith: stem } },
    orderBy: { number: "desc" },
    select: { number: true },
  });
  return nextInSeries(stem, last?.number);
}

const ITEMS = [
  ["CBL-4C16", "4-core 16mm² XLPE/SWA cable", "Cable", "MTR", 38, 250],
  ["CBL-4C25", "4-core 25mm² XLPE/SWA cable", "Cable", "MTR", 57, 180],
  ["CBL-1C95", "Single-core 95mm² PVC cable", "Cable", "MTR", 46, 200],
  ["TRY-300", "Cable tray 300mm perforated, 3m", "Cable", "EA", 96, 60],
  ["GLD-M25", "Brass gland M25 with earth tag", "Fittings", "EA", 11.5, 400],
  ["GLD-M32", "Brass gland M32 with earth tag", "Fittings", "EA", 16.25, 300],
  ["LUG-95", "Copper lug 95mm²", "Fittings", "EA", 8.4, 500],
  ["PIP-CS4", "Carbon steel pipe 4in Sch40, 6m", "Piping", "EA", 412, 40],
  ["PIP-CS6", "Carbon steel pipe 6in Sch40, 6m", "Piping", "EA", 688, 25],
  ["FLG-4WN", "Weld-neck flange 4in 150#", "Piping", "EA", 74, 120],
  ["FLG-6WN", "Weld-neck flange 6in 150#", "Piping", "EA", 132, 80],
  ["GSK-4SP", "Spiral wound gasket 4in 150#", "Piping", "EA", 21, 200],
  ["BLT-M20", "Stud bolt M20 x 120 with nuts", "Fittings", "EA", 6.8, 800],
  ["ELC-7018", "Welding electrode E7018 3.2mm, 5kg", "Consumables", "KGM", 27, 150],
  ["WIR-MIG", "MIG wire ER70S-6 1.2mm, 15kg", "Consumables", "KGM", 19.5, 120],
  ["GAS-ARG", "Argon cylinder 50L", "Consumables", "EA", 185, 20],
  ["DSC-115", "Cutting disc 115mm", "Consumables", "EA", 3.2, 600],
  ["PNT-EPX", "Epoxy primer, 20L", "Consumables", "LTR", 34, 80],
  ["STL-RSA", "RSA 75x75x8 angle, 6m", "Steel", "EA", 214, 45],
  ["STL-UB2", "UB 203x133x25, 6m", "Steel", "EA", 690, 18],
  ["PPE-GLV", "Cut-resistant gloves, pair", "PPE", "PR", 14, 300],
  ["PPE-HLM", "Safety helmet with chinstrap", "PPE", "EA", 38, 150],
  ["PPE-HRN", "Full body harness with lanyard", "PPE", "EA", 275, 40],
  ["TOO-TRQ", "Torque wrench 1/2in 40-200Nm", "Tools", "EA", 640, 6],
];

/**
 * Things bought that never reach a shelf: PRO work, hire, subcontract labour.
 *
 * Separate from ITEMS because they are created with "Keep stock of this"
 * unticked — no reorder level, no stock, and they must never appear on a stock
 * report. A tester ordering PRO work (PRC-11) starts from these rather than
 * from an empty Items screen.
 */
const SERVICES = [
  ["SVC-PRO-VISA", "PRO — new employment visa", "PRO services", "EA", 3500],
  ["SVC-PRO-REN", "PRO — visa renewal", "PRO services", "EA", 2200],
  ["SVC-PRO-LC", "PRO — labour card renewal", "PRO services", "EA", 850],
  ["SVC-PRO-EID", "PRO — Emirates ID typing and biometrics", "PRO services", "EA", 370],
  ["SVC-HIRE-CRN", "Crane hire, 50t, per day", "Plant hire", "DAY", 2400],
];

const SUPPLIERS = [
  ["SUP-EMCAB", "Emirates Cable Trading LLC", "procurement@example-emcab.test", "Fatima Al Zaabi"],
  ["SUP-GULFP", "Gulf Pipe & Fittings FZE", "sales@example-gulfp.test", "Rakesh Menon"],
  ["SUP-ALMAS", "Al Masaood Industrial Supplies", "orders@example-almas.test", "Yousef Haddad"],
  ["SUP-WELDC", "Weldcraft Consumables LLC", "info@example-weldc.test", "Priya Nair"],
  ["SUP-SAFEZ", "SafeZone PPE Distribution", "sales@example-safez.test", "Daniel Okafor"],
  ["SUP-STEEL", "Northern Steel Stockholders", "enquiries@example-steel.test", "Aisha Rahman"],
  // Not a material supplier: the outsourced PRO company, for PRC-11 and FIN-09.
  ["SUP-PROCO", "Gulf PRO Services LLC", "documents@example-proco.test", "Mariam Al Blooshi"],
];

const CUSTOMERS = [
  ["CUS-ADNOC", "Al Dhafra Petroleum Services", "Hamdan Al Suwaidi", "projects@example-adps.test"],
  ["CUS-EMSTL", "Emirates Steel Industries", "Noura Al Marzooqi", "tenders@example-emstl.test"],
  ["CUS-DPORT", "Deep Port Logistics FZC", "Ravi Krishnan", "facilities@example-dport.test"],
  ["CUS-SHJWT", "Sharjah Water & Power", "Mariam Al Hosani", "contracts@example-shjwt.test"],
  ["CUS-JEBEL", "Jebel Industrial Estates", "Omar Faruk", "maintenance@example-jebel.test"],
];

async function build() {
  const company = WANT
    ? await db.company.findFirst({ where: { code: WANT } })
    : // The one with the most jobs on it. Test data is worth far more sitting
      // against real contracts than in whichever company happens to sort first,
      // because that is what puts material cost on a job cost report.
      (
        await db.company.findMany({
          where: { isActive: true },
          include: { _count: { select: { jobs: true } } },
        })
      ).sort((a, b) => b._count.jobs - a._count.jobs)[0];
  if (!company) {
    throw new Error(WANT ? `There is no company with code ${WANT}.` : "There are no companies. Run the seed first.");
  }
  const tenantId = company.tenantId;
  const cid = company.id;
  console.log(`\nBuilding test data in ${company.code} — ${company.name}.\n`);

  /* --- stores and bins -------------------------------------------------- */
  const storeSpec = [
    ["MAIN", "Main store, Mussafah", "Main store", "Mussafah M-17", true],
    ["SITE1", "Site store, Ruwais", "Site store", "Ruwais refinery, gate 4", false],
    ["YARD", "Plant yard, Mussafah", "Plant yard", "Mussafah M-17 rear", false],
    ["LAYDN", "Lay-down area, Ruwais", "Lay-down area", "Ruwais plot 12", false],
  ];
  const stores = {};
  for (const [code, name, kind, location, isDefault] of storeSpec) {
    stores[code] = await db.store.create({
      // The main store is the default. Hardcoding false here meant every form
      // opened on the lay-down area at Ruwais, which is the last place a
      // storeman in Mussafah wants a receipt to land by accident.
      data: { companyId: cid, code: P + code, name, kind, location, isDefault },
    });
  }
  tally("stores", storeSpec.length);

  // Only the main store is divided into bins. A lay-down area deliberately is
  // not, so the screens get tested both ways round.
  const binSpec = [
    ["MAIN", "A-01", "A", "Cable"], ["MAIN", "A-02", "A", "Cable"], ["MAIN", "B-01", "B", "Fittings"],
    ["MAIN", "B-02", "B", "Fittings"], ["MAIN", "C-01", "C", "Piping"], ["MAIN", "C-02", "C", "Piping"],
    ["MAIN", "D-01", "D", "Consumables"], ["MAIN", "E-01", "E", "PPE"], ["MAIN", "E-02", "E", "Tools"],
    ["SITE1", "S-01", null, "Consumables"], ["SITE1", "S-02", null, "PPE"],
    ["YARD", "Y-01", null, "Steel"], ["YARD", "Y-02", null, "Piping"],
  ];
  const bins = {};
  for (const [store, code, zone, materialType] of binSpec) {
    bins[`${store}/${code}`] = await db.storageBin.create({
      data: { storeId: stores[store].id, code, zone, materialType },
    });
  }
  tally("storage bins", binSpec.length);

  /* --- items ------------------------------------------------------------- */
  const items = {};
  for (const [code, name, category, unitCode, standardCost, reorderLevel] of ITEMS) {
    items[code] = await db.item.create({
      data: {
        companyId: cid, code: P + code, name, category, unitCode, standardCost, reorderLevel,
        // The pressure-retaining and lifting parts are the ones that must not
        // reach a job before QA has looked at them.
        requiresInspection: ["PIP-CS4", "PIP-CS6", "FLG-4WN", "FLG-6WN", "PPE-HRN", "STL-UB2"].includes(code),
      },
    });
  }
  tally("items", ITEMS.length);

  /* --- suppliers and customers, with people at them ---------------------- */
  const parties = {};
  for (const [code, name, email, contactPerson] of SUPPLIERS) {
    parties[code] = await db.party.create({
      data: {
        companyId: cid, code: P + code, name, type: "Supplier", email, contactPerson,
        creditDays: pick([30, 45, 60]), emirate: pick(["Abu Dhabi", "Dubai", "Sharjah"]), city: null,
      },
    });
    await db.partyContact.createMany({
      data: [
        { partyId: parties[code].id, name: contactPerson, role: "Sales", email, isPrimary: true },
        {
          partyId: parties[code].id, name: pick(["Imran Sheikh", "Lina Botros", "Sanjay Pillai", "Huda Kassem"]),
          role: "Accounts", email: email.replace("@", "+accounts@"), isPrimary: false,
        },
      ],
    });
  }
  for (const [code, name, contactPerson, email] of CUSTOMERS) {
    parties[code] = await db.party.create({
      data: {
        companyId: cid, code: P + code, name, type: "Customer", email, contactPerson,
        creditDays: pick([30, 60, 90]), emirate: pick(["Abu Dhabi", "Dubai", "Sharjah"]), city: null,
      },
    });
    await db.partyContact.createMany({
      data: [
        { partyId: parties[code].id, name: contactPerson, role: "Projects", email, isPrimary: true },
        {
          partyId: parties[code].id, name: pick(["Khalid Nasser", "Grace Mwangi", "Arun Varghese", "Salma Idrissi"]),
          role: "Procurement", email: email.replace("@", "+procurement@"), isPrimary: false,
        },
      ],
    });
  }
  tally("suppliers and customers, with two contacts each", SUPPLIERS.length + CUSTOMERS.length);

  /* --- services, which are bought but never stocked ---------------------- */
  for (const [code, name, category, unitCode, standardCost] of SERVICES) {
    await db.item.create({
      data: {
        companyId: cid, code: P + code, name, category, unitCode, standardCost,
        // The whole point of them: no shelf, so no reorder level and no stock.
        isStocked: false, description: MARK,
      },
    });
  }
  tally("services, bought but never stocked", SERVICES.length);

  /* --- stock, through the real posting path ------------------------------ */
  const jobs = await db.job.findMany({ where: { companyId: cid, status: "Open" }, take: 6 });
  if (jobs.length === 0) console.log("   note no open jobs, so nothing is issued to a contract");

  const binFor = (store, category) => {
    const inStore = Object.entries(bins).filter(([key]) => key.startsWith(store + "/"));
    // The bin meant for that kind of material, or failing that any bin in the
    // store. A mismatch is warned about rather than refused, which is the
    // behaviour worth having in the test data too.
    const match = inStore.find(([, b]) => b.materialType === category) ?? inStore[0];
    return match ? match[1].id : null;
  };

  let receipts = 0, issues = 0, refused = 0;
  const supplierCodes = SUPPLIERS.map((s) => s[0]);

  // Receipts first, spread over four months and across suppliers, so vendor
  // rating has the three deliveries it needs before it will say anything.
  for (const [code, , category] of ITEMS.map((i) => [i[0], i[1], i[2]])) {
    const item = items[code];
    for (let n = 0; n < 4; n++) {
      const days = 110 - n * 26 - Math.floor(rnd() * 6);
      const supplier = parties[supplierCodes[(ITEMS.findIndex((i) => i[0] === code) + n) % supplierCodes.length]];
      const std = ITEMS.find((i) => i[0] === code)[4];
      const res = await recordMovement({
        companyId: cid, postedBy: BY, kind: "Receipt",
        itemId: item.id, storeId: stores.MAIN.id, binId: binFor("MAIN", category),
        date: ago(days), quantity: Math.ceil(between(10, 120, 0)),
        unitCost: between(std * 0.9, std * 1.12),
        partyId: supplier.id,
        reference: `DN-${String(4000 + receipts).padStart(5, "0")}`,
        notes: note("Goods received"),
      });
      if (res.ok) receipts++;
      else { refused++; console.log(`   note receipt refused: ${res.error}`); }
    }
  }
  tally("goods receipts, each posted to the ledger", receipts);

  // The ones that need QA get looked at — most passed, one rejected, and some
  // deliberately left pending so the awaiting-inspection screen has something.
  const pending = await db.stockMovement.findMany({
    where: { companyId: cid, kind: "Receipt", inspection: "Pending" },
    orderBy: { date: "asc" },
  });
  let inspected = 0;
  for (const [i, m] of pending.entries()) {
    if (i % 4 === 3) continue; // left for somebody to do during the UAT
    const res = await inspectReceipt({
      movementId: m.id,
      outcome: i === 2 ? "Rejected" : "Accepted",
      inspectedBy: "QA/QC inspector",
      note: i === 2 ? note("Mill certificate does not match the heat number on the pipe") : note("Certificate checked"),
    });
    if (res.ok) inspected++;
  }
  tally("receipts inspected, some left pending on purpose", inspected);

  // Issues to jobs, which is what puts material cost on a contract.
  if (jobs.length) {
    for (let n = 0; n < 60; n++) {
      const [code, , category] = (() => { const it = pick(ITEMS); return [it[0], it[1], it[2]]; })();
      const res = await recordMovement({
        companyId: cid, postedBy: BY, kind: "Issue",
        itemId: items[code].id, storeId: stores.MAIN.id, binId: binFor("MAIN", category),
        date: ago(Math.floor(between(2, 80, 0))), quantity: Math.ceil(between(1, 25, 0)),
        jobId: pick(jobs).id,
        reference: `MI-${String(7000 + n).padStart(5, "0")}`,
        notes: note("Issued to site"),
      });
      if (res.ok) issues++;
      // An issue is refused when the shelf cannot cover it, which is the rule
      // working. Worth counting, not worth stopping for.
      else refused++;
    }
  }
  tally("issues to jobs, each posted to the ledger", issues);

  // A few transfers and count adjustments, so those screens are not empty.
  let others = 0;
  for (const code of ["ELC-7018", "DSC-115", "PPE-GLV", "GSK-4SP"]) {
    const category = ITEMS.find((i) => i[0] === code)[2];
    const res = await transferStock({
      companyId: cid, postedBy: BY, itemId: items[code].id,
      storeId: stores.MAIN.id, binId: binFor("MAIN", category),
      toStoreId: stores.SITE1.id, toBinId: binFor("SITE1", category),
      date: ago(Math.floor(between(5, 40, 0))), quantity: Math.ceil(between(2, 12, 0)),
      reference: `TR-${String(300 + others).padStart(4, "0")}`, notes: note("Sent to site store"),
    });
    if (res.ok) others += 2;
  }
  for (const [code, kind] of [["BLT-M20", "Adjustment in"], ["LUG-95", "Adjustment out"], ["GLD-M25", "Adjustment out"]]) {
    const category = ITEMS.find((i) => i[0] === code)[2];
    const res = await recordMovement({
      companyId: cid, postedBy: BY, kind, itemId: items[code].id,
      storeId: stores.MAIN.id, binId: binFor("MAIN", category),
      date: ago(Math.floor(between(3, 30, 0))), quantity: Math.ceil(between(1, 8, 0)),
      unitCost: ITEMS.find((i) => i[0] === code)[4],
      reference: `CS-${String(90 + others).padStart(4, "0")}`, notes: note("Stock count difference"),
    });
    if (res.ok) others++;
  }
  tally("transfers and count adjustments", others);
  if (refused) console.log(`   note ${refused} movements were refused by the rules, which is them working`);

  /* --- material requests -------------------------------------------------- */
  const requestStatuses = ["Draft", "Submitted", "Approved", "Approved", "Ordered", "Issued", "Cancelled", "Submitted"];
  let requests = 0;
  const requestRows = [];
  for (const status of requestStatuses) {
    const number = await nextNumber("materialRequest", company.code, "MR");
    const row = await db.materialRequest.create({
      data: {
        companyId: cid, number, status,
        jobId: jobs.length ? pick(jobs).id : null, storeId: stores.MAIN.id,
        neededBy: on(-Math.floor(between(3, 30, 0))),
        requestedBy: pick(["Site engineer", "Foreman", "Project engineer"]),
        notes: note("Raised for the next fabrication sequence"),
        lines: {
          create: Array.from({ length: 2 + Math.floor(rnd() * 3) }, (_, i) => {
            const it = pick(ITEMS);
            return {
              itemId: items[it[0]].id, description: it[1], unitCode: it[3],
              quantity: Math.ceil(between(5, 60, 0)), order: i,
            };
          }),
        },
      },
    });
    requestRows.push(row);
    requests++;
  }
  tally("material requests across every status", requests);

  /* --- purchase orders ---------------------------------------------------- */
  let orders = 0;
  for (const status of ["Draft", "Awaiting approval", "Approved", "Approved", "Part received", "Received", "Cancelled"]) {
    const supplier = parties[pick(supplierCodes)];
    const lines = Array.from({ length: 2 + Math.floor(rnd() * 3) }, (_, i) => {
      const it = pick(ITEMS);
      const quantity = Math.ceil(between(10, 90, 0));
      const unitPrice = between(it[4] * 0.92, it[4] * 1.1);
      return {
        itemId: items[it[0]].id, description: it[1], unitCode: it[3],
        quantity, unitPrice, netAmount: Number((quantity * unitPrice).toFixed(2)), sortOrder: i,
      };
    });
    const number = await nextNumber("purchaseOrder", company.code, "PO");
    await db.purchaseOrder.create({
      data: {
        companyId: cid, number, status, partyId: supplier.id, partyName: supplier.name,
        jobId: jobs.length ? pick(jobs).id : null, storeId: stores.MAIN.id,
        requestId: pick(requestRows).id,
        date: on(Math.floor(between(10, 70, 0))),
        expectedDate: on(-Math.floor(between(2, 25, 0))),
        total: Number(lines.reduce((s, l) => s + l.netAmount, 0).toFixed(2)),
        raisedBy: "Procurement officer",
        approvedBy: ["Approved", "Part received", "Received"].includes(status) ? "Finance manager" : null,
        approvedAt: ["Approved", "Part received", "Received"].includes(status) ? on(Math.floor(between(8, 60, 0))) : null,
        notes: note("Against the approved material request"),
        lines: { create: lines },
      },
    });
    orders++;
  }
  tally("purchase orders across every status", orders);

  /* --- RFQs with competing quotes ----------------------------------------- */
  let rfqs = 0;
  for (const status of ["Draft", "Sent", "Quoted", "Awarded"]) {
    const lineItems = Array.from({ length: 3 }, () => pick(ITEMS));
    const number = await nextNumber("rfq", company.code, "RFQ");
    const rfq = await db.rfq.create({
      data: {
        companyId: cid, number, status,
        requestId: pick(requestRows).id, jobId: jobs.length ? pick(jobs).id : null,
        date: on(Math.floor(between(15, 60, 0))),
        neededBy: on(-Math.floor(between(5, 30, 0))),
        raisedBy: "Procurement officer",
        notes: note("Three suppliers invited"),
        lines: {
          create: lineItems.map((it, i) => ({
            itemId: items[it[0]].id, description: it[1], unitCode: it[3],
            quantity: Math.ceil(between(20, 120, 0)), sortOrder: i,
          })),
        },
      },
      include: { lines: true },
    });

    if (status !== "Draft") {
      const invited = [supplierCodes[0], supplierCodes[2], supplierCodes[4]].map((c) => parties[c]);
      for (const [n, supplier] of invited.entries()) {
        const quoted = status !== "Sent" || n === 0;
        const quote = await db.rfqQuote.create({
          data: {
            rfqId: rfq.id, partyId: supplier.id, partyName: supplier.name,
            invitedAt: on(Math.floor(between(14, 55, 0))),
            receivedAt: quoted ? on(Math.floor(between(6, 20, 0))) : null,
            delivery: quoted ? between(0, 900) : 0,
            leadTimeDays: quoted ? Math.ceil(between(5, 35, 0)) : null,
            validUntil: quoted ? on(-Math.floor(between(10, 45, 0))) : null,
            notes: quoted ? "Ex-works, payment 45 days" : null,
          },
        });
        if (quoted) {
          for (const line of rfq.lines) {
            await db.rfqQuoteLine.create({
              data: {
                quoteId: quote.id, rfqLineId: line.id,
                // Each supplier is a little dearer or cheaper than the last, so
                // the comparison screen has a real winner to show.
                unitPrice: between(20, 400) * (1 + n * 0.06),
              },
            });
          }
        }
      }
      if (status === "Awarded") {
        await db.rfq.update({
          where: { id: rfq.id },
          data: {
            awardedPartyId: invited[0].id, awardedAt: on(5), awardedBy: "Procurement manager",
            awardReason: "Cheapest on the like-for-like comparison and could deliver inside the programme.",
          },
        });
      }
    }
    rfqs++;
  }
  tally("requests for quotation, with competing supplier quotes", rfqs);

  /* --- equipment and calibration ------------------------------------------ */
  const kitSpec = [
    ["TRQ-0091", "Torque wrench 1/2in 40-200Nm", "Lifting and torque", 12, "In store"],
    ["TRQ-0092", "Torque wrench 3/4in 100-600Nm", "Lifting and torque", 12, "On site"],
    ["PRG-0033", "Pressure gauge 0-40 bar", "Instrumentation", 6, "On site"],
    ["PRG-0034", "Pressure gauge 0-100 bar", "Instrumentation", 6, "In store"],
    ["MMT-0012", "Insulation resistance tester 5kV", "Electrical test", 12, "On site"],
    ["MMT-0013", "Earth loop impedance tester", "Electrical test", 12, "On site"],
    ["WLD-0007", "Welding machine 400A", "Welding", 24, "On site"],
    ["LFT-0021", "Chain block 5t", "Lifting and torque", 12, "In store"],
    ["LFT-0022", "Webbing sling 4t x 3m", "Lifting and torque", 6, "On site"],
    ["CAL-0005", "Vernier caliper 300mm", "Instrumentation", 12, "In store"],
  ];
  let kit = 0, certs = 0;
  for (const [n, [serialNo, description, category, months, status]] of kitSpec.entries()) {
    const equipment = await db.equipment.create({
      data: {
        companyId: cid, serialNo: P + serialNo, description, category, calibrationMonths: months, status,
        manufacturer: pick(["Norbar", "Fluke", "Megger", "Wika", "Yale"]),
        storeId: status === "In store" ? stores.YARD.id : null,
        jobId: status === "On site" && jobs.length ? pick(jobs).id : null,
        heldBy: status === "On site" ? pick(["Site supervisor", "QA/QC inspector", "Foreman"]) : null,
        notes: note("Owned plant"),
      },
    });
    kit++;

    // Where the newest certificate sits in its cycle, which is what decides
    // whether the register shows this item as in date, due, or overdue. Picked
    // deliberately rather than left to the arithmetic: a first attempt stacked
    // every certificate a full interval back, so the newest one always expired
    // on the day it was written and the whole register came out red.
    const cycle = months * 30;
    const latestAge =
      n % 5 === 0 ? cycle + 25 // overdue, and somebody needs to chase it
      : n % 5 === 1 ? cycle - 12 // due inside the month
      : Math.round(cycle * between(0.1, 0.6, 3)); // comfortably in date

    const history = n % 5 === 0 ? 3 : 2;
    for (let h = history - 1; h >= 0; h--) {
      const calibratedOn = on(latestAge + h * cycle);
      await db.calibrationRecord.create({
        data: {
          equipmentId: equipment.id,
          calibratedOn,
          // One failure in the history, so the screen has to show that state
          // too — and it is not the newest, because a failed instrument would
          // not still be in service.
          result: n === 6 && h === 1 ? "Failed" : "Passed",
          validTo: new Date(calibratedOn.getTime() + cycle * 86400000),
          certificateNo: `CERT/${2026 - h}/${String(1000 + n * 7 + h).padStart(4, "0")}`,
          calibratedBy: pick(["Gulf Calibration Labs", "Emirates Metrology Centre"]),
          cost: between(150, 900),
          recordedBy: "QA/QC inspector",
        },
      });
      certs++;
    }
  }
  tally("items of equipment", kit);
  tally("calibration certificates, some in date, some overdue", certs);

  /* --- material returns from site ----------------------------------------- */
  //
  // Through postReturn, like everything else. Writing these rows directly was
  // the one place this script went behind the rules, and it showed the moment
  // anybody opened the screen: the conditions are "Reusable" and "Scrap", the
  // direct insert happily stored "Good" and "Damaged", and the register then
  // read every one of them as scrapped — nothing back on the shelf and nothing
  // credited to the job. postReturn would have refused them outright.
  let returns = 0;
  if (jobs.length) {
    for (const [n, condition] of ["Reusable", "Scrap", "Reusable"].entries()) {
      const issued = await db.stockMovement.findFirst({
        where: { companyId: cid, kind: "Issue", notes: { contains: MARK } },
        skip: n * 3,
        orderBy: { date: "desc" },
      });
      if (!issued) continue;
      const res = await postReturn({
        companyId: cid,
        postedBy: BY,
        jobId: issued.jobId,
        storeId: stores.MAIN.id,
        date: ago(Math.floor(between(2, 15, 0))),
        returnedBy: "Site supervisor",
        notes: note("Surplus off the fabrication sequence"),
        lines: [
          {
            itemId: issued.itemId,
            condition,
            // A third of what went out, so it never claims back more than the
            // job actually has outstanding.
            quantity: Math.max(1, Math.floor(issued.quantity / 3)),
            // Back on the shelf it came off. Scrap never reaches a bin.
            binId: condition === "Reusable" ? issued.binId : null,
            notes: condition === "Scrap" ? "Cut offcuts, not worth keeping" : "Surplus, still in wrapping",
          },
        ],
      });
      if (res.ok) returns++;
      else console.log(`   note return refused: ${res.error}`);
    }
  }
  tally("material returns from site, posted through the rules", returns);

  /* --- enquiries, right across the pipeline -------------------------------- */
  // Sources must be ones the form actually offers, or the report groups rows
  // nobody could have created.
  const ALLOWED_SOURCES = ["Existing customer", "Referral", "Tender portal", "Consultant", "Cold approach", "Website"];
  const LEADS = [
    ["Tank farm earthing upgrade", "CUS-ADNOC", 480000, "Site visit", "Tender portal"],
    ["Cable replacement, substation 4", "CUS-EMSTL", 265000, "Qualifying", "Existing customer"],
    ["Pipe rack fabrication, phase 2", "CUS-DPORT", 1250000, "Estimating", "Referral"],
    ["Fire water line refurbishment", "CUS-SHJWT", 720000, "Quoted", "Tender portal"],
    ["Workshop lighting replacement", "CUS-JEBEL", 95000, "Negotiating", "Cold approach"],
    ["Instrument tubing, unit 12", "CUS-ADNOC", 310000, "New", "Existing customer"],
    ["Structural steel walkways", "CUS-EMSTL", 540000, "Estimating", "Tender portal"],
    ["Jetty crane power supply", "CUS-DPORT", 880000, "Negotiating", "Existing customer"],
    ["Pump house MCC replacement", "CUS-SHJWT", 430000, "Quoted", "Tender portal"],
    ["Painting and insulation, tank 7", "CUS-JEBEL", 175000, "Qualifying", "Referral"],
    ["Emergency shutdown valve tie-ins", "CUS-ADNOC", 660000, "Site visit", "Existing customer"],
    ["Compressor house HVAC ducting", "CUS-EMSTL", 240000, "New", "Website"],
    ["Effluent pipeline, 600m", "CUS-SHJWT", 1400000, "Negotiating", "Tender portal"],
    ["Warehouse mezzanine steelwork", "CUS-JEBEL", 385000, "Lost", "Cold approach"],
  ];

  const leadIds = {};
  let leads = 0, interactions = 0, visits = 0;
  for (const [title, customer, value, stage, source] of LEADS) {
    if (!ALLOWED_SOURCES.includes(source)) {
      throw new Error(`"${source}" is not a source the enquiry form offers. Use one of: ${ALLOWED_SOURCES.join(", ")}`);
    }
    const party = parties[customer];
    const contact = await db.partyContact.findFirst({ where: { partyId: party.id, isPrimary: true } });
    const res = await createLead({
      companyId: cid, raisedBy: BY, title, customerName: party.name, partyId: party.id,
      source, estimatedValue: value,
      contactName: contact?.name ?? null, contactEmail: contact?.email ?? null,
      contactPhone: "+971 2 555 0" + String(100 + leads).slice(-3),
      description: `${title} at ${party.name}. Scope to be confirmed against the enquiry documents.`,
      budgetStated: rnd() > 0.4 ? Number((value * between(0.9, 1.15, 4)).toFixed(0)) : null,
      decisionMaker: rnd() > 0.35 ? pick(["Projects Manager", "Head of Maintenance", "Contracts Manager"]) : null,
      requiredBy: ago(-Math.floor(between(30, 180, 0))),
      scopeDefined: rnd() > 0.4,
      competitors: rnd() > 0.5 ? pick(["Al Jaber Energy", "Descon", "Target Engineering"]) : null,
      ownerName: pick(["Bibin Thomas", "Estimating lead", "Commercial manager"]),
      notes: note("Enquiry logged"),
    });
    if (!res.ok) { console.log(`   note enquiry refused: ${res.error}`); continue; }
    leadIds[title] = res.leadId;
    leads++;

    await logInteraction({
      leadId: res.leadId, kind: "Call", by: BY,
      summary: "Called to acknowledge the enquiry and agree a date to walk the site.",
    });
    interactions++;

    // Walk it up the pipeline the way it actually goes, one stage at a time,
    // so the tracker and the history show a real path rather than a jump.
    const path = ["Qualifying", "Site visit", "Estimating", "Quoted", "Negotiating", "Won"];
    const finalStage = stage === "Lost" ? "Lost" : stage;
    const upTo = finalStage === "Lost" ? path.indexOf("Estimating") : path.indexOf(finalStage);

    for (let s = 0; s <= upTo; s++) {
      const to = path[s];
      if (to === "Site visit") {
        const visit = await recordVisit({
          leadId: res.leadId, visitedOn: ago(Math.floor(between(20, 60, 0))),
          visitedBy: pick(["Estimating lead", "Project engineer"]), by: BY,
          findings: null, reportRef: null,
        });
        if (visit.ok) {
          visits++;
          // Most reports are in. One is deliberately left outstanding, because
          // the rule that stops an enquiry moving on without it is worth seeing.
          if (leads % 6 !== 0) {
            await submitReport({
              visitId: visit.visitId, by: BY,
              reportRef: `SV/${String(200 + visits).padStart(4, "0")}`,
              findings:
                "Access is from the north gate. Existing routes are congested and will need new tray at high level. " +
                "Two shutdowns will be required and the client wants both inside one window.",
            });
          }
        }
      }
      const moved = await moveStage({ leadId: res.leadId, to, by: BY, note: `Moved to ${to}.` });
      if (!moved.ok) break; // a rule stopped it, which is the rule working
      interactions++;
    }

    if (finalStage === "Lost") {
      await moveStage({
        leadId: res.leadId, to: "Lost", by: BY,
        lostReason: pick([
          "Priced above the client's budget and they would not move on scope.",
          "Client awarded to an incumbent on an existing framework.",
          "Programme could not be met alongside current commitments.",
        ]),
        lostTo: pick(["Al Jaber Energy", "Descon", "Target Engineering"]),
      });
      interactions++;
    }
  }
  tally("enquiries walked up the pipeline stage by stage", leads);
  tally("site visits, most with a report in", visits);
  tally("logged interactions", interactions);

  /* --- estimates ----------------------------------------------------------- */
  const WORK = [
    ["Cable pulling and termination", "Metre", 1800, 22, 0.35, 165, 0, 0],
    ["Cable tray installation at high level", "Metre", 950, 48, 0.55, 165, 0.1, 220],
    ["Pipe spool fabrication", "Tonne", 42, 1750, 26, 155, 4, 260],
    ["Pipe erection and bolting", "Tonne", 42, 180, 14, 155, 2.5, 260],
    ["Structural steel erection", "Tonne", 65, 240, 11, 150, 3.5, 310],
    ["Surface preparation and painting", "Square metre", 2400, 18, 0.28, 120, 0.05, 90],
    ["Testing, flushing and reinstatement", "Lump sum", 1, 26000, 320, 150, 40, 260],
    ["Scaffolding, erect and dismantle", "Square metre", 1600, 12, 0.22, 110, 0, 0],
  ];

  const estimateIds = {};
  let estimates = 0, estLines = 0, takeoffs = 0;
  const estimateFor = [
    "Fire water line refurbishment", "Pipe rack fabrication, phase 2", "Structural steel walkways",
    "Jetty crane power supply", "Workshop lighting replacement", "Effluent pipeline, 600m",
    "Pump house MCC replacement", "Emergency shutdown valve tie-ins",
  ];

  for (const [n, title] of estimateFor.entries()) {
    const leadId = leadIds[title];
    // Settled once and used for both calls, so the estimate is priced on the
    // basis it says it is priced on.
    const basis = {
      overheadPct: between(0.06, 0.14, 4),
      fixedCosts: between(8000, 45000, 0),
      basisKind: n % 3 === 0 ? "margin" : "markup",
      basisValue: n % 3 === 0 ? between(0.12, 0.22, 4) : between(0.15, 0.32, 4),
    };
    const res = await createEstimate({
      companyId: cid, preparedBy: pick(["Estimating lead", "Senior estimator"]),
      title: `${title} — priced bid`, leadId: leadId ?? null,
      ...basis,
      notes: note("Built up from the enquiry drawings"),
    });
    if (!res.ok) { console.log(`   note estimate refused: ${res.error}`); continue; }
    estimateIds[title] = res.estimateId;
    estimates++;

    const chosen = WORK.slice(0, 4 + (n % 4));
    for (const [d, [description, unit, quantity, materialCost, labourHours, labourRate, plantHours, plantRate]] of
      chosen.entries()) {
      const line = await saveLine({
        estimateId: res.estimateId, ref: `${String.fromCharCode(65 + d)}.${d + 1}`,
        description, unit, quantity,
        materialCost, labourHours, labourRate, plantHours, plantRate,
        subcontractCost: description.startsWith("Scaffolding") ? between(9, 16) : 0,
      });
      if (!line.ok) continue;
      estLines++;

      // A couple of lines get a real take-off, so the material figure is built
      // from quantities rather than typed as a lump.
      if (d < 2) {
        for (const it of [pick(ITEMS), pick(ITEMS)]) {
          const t = await saveTakeoff({
            lineId: line.lineId, itemId: items[it[0]].id, description: it[1],
            unitCode: it[3], perUnit: between(0.2, 3.5), wastage: pick([0, 0.025, 0.05, 0.075]),
            unitCost: between(it[4] * 0.95, it[4] * 1.08),
          });
          if (t.ok) takeoffs++;
          else console.log(`   note take-off refused: ${t.error}`);
        }
      }
    }

    // Run it through setBasis too, which is the path the pricing screen takes
    // once the lines are in and the estimator sees what it comes to.
    await setBasis({ estimateId: res.estimateId, ...basis });
    // Most are priced and ready to quote from; two are left in draft.
    if (n < estimateFor.length - 2) await markPriced(res.estimateId);
  }
  tally("estimates", estimates);
  tally("estimate lines", estLines);
  tally("take-off lines behind the material figures", takeoffs);

  /* --- quotations across every status -------------------------------------- */
  const quoteFor = [
    ["Fire water line refurbishment", "Issued"],
    ["Pipe rack fabrication, phase 2", "Awaiting approval"],
    ["Structural steel walkways", "Approved"],
    ["Jetty crane power supply", "Accepted"],
    ["Workshop lighting replacement", "Issued"],
    ["Effluent pipeline, 600m", "Draft"],
    ["Pump house MCC replacement", "Declined"],
  ];

  let quotations = 0;
  for (const [title, want] of quoteFor) {
    const estimateId = estimateIds[title];
    if (!estimateId) continue;
    const lead = leadIds[title] ? await db.lead.findUnique({ where: { id: leadIds[title] } }) : null;

    const res = await createQuotation({
      companyId: cid, preparedBy: "Commercial manager", estimateId,
      title: `${title} — quotation`,
      customerName: lead?.customerName ?? null, partyId: lead?.partyId ?? null,
      validUntil: ago(-Math.floor(between(20, 60, 0))),
      terms: "Validity 45 days. Payment 45 days from invoice. Delivery to site included. VAT extra at 5%.",
      notes: note("Raised from the priced estimate"),
    });
    if (!res.ok) { console.log(`   note quotation refused (${title}): ${res.error}`); continue; }
    quotations++;
    if (want === "Draft") continue;

    const sent = await submitQuotation(res.quotationId, tenantId, "Commercial manager");
    if (!sent.ok) { console.log(`   note could not submit (${title}): ${sent.error}`); continue; }
    if (want === "Awaiting approval") continue;

    // Sign the approval off the way a manager would, then let the quotation
    // read it — the same path the screen takes.
    const quote = await db.quotation.findUnique({ where: { id: res.quotationId } });
    if (quote?.approvalRequestId) {
      await db.approvalStep.updateMany({
        where: { requestId: quote.approvalRequestId },
        data: { status: "Approved", decidedBy: "Managing Director", decidedAt: on(3) },
      });
      const steps = await db.approvalStep.count({ where: { requestId: quote.approvalRequestId } });
      await db.approvalRequest.update({
        where: { id: quote.approvalRequestId },
        // Past the last step, which is what a request looks like once every
        // level has signed. The decision date lives on the step, not here.
        data: { status: "Approved", currentStep: steps + 1 },
      });
      await syncQuoteApproval(res.quotationId);
    }
    if (want === "Approved") continue;

    const contact = lead?.partyId
      ? await db.partyContact.findFirst({ where: { partyId: lead.partyId, isPrimary: true } })
      : null;
    // send:false — a test data run must never put mail on the wire.
    const out = await issueQuotation({
      quotationId: res.quotationId,
      issuedTo: contact?.email ?? "projects@example.test",
      by: "Commercial manager", send: false,
    });
    if (!out.ok) { console.log(`   note could not issue (${title}): ${out.error}`); continue; }
    if (want === "Issued") continue;

    if (want === "Accepted") {
      const won = await acceptQuotation({
        quotationId: res.quotationId,
        poNumber: `PO-${String(88000 + quotations)}`,
        poDate: ago(6),
        // Customers trim. The job carries their figure, not ours.
        poValue: Number((res.total * 0.97).toFixed(2)),
        poRef: "Client framework 2026",
        acknowledged: true,
        by: "Commercial manager",
        jobCode: `${P}JOB-${String(900 + quotations)}`,
      });
      if (!won.ok) console.log(`   note could not accept (${title}): ${won.error}`);
    }

    if (want === "Declined") {
      await declineQuotation({
        quotationId: res.quotationId, by: "Commercial manager",
        reason: "Client advised the award went elsewhere on price. Feedback: we were 11% above the winning bid.",
      });
    }
  }
  tally("quotations across every status", quotations);
}

/* -------------------------------------------------------------------- main */

try {
  // Always clear first, so a second run replaces the test data rather than
  // colliding with it on the first unique code it reaches.
  await clean();
  if (!ONLY_CLEAN) {
    made = 0;
    await build();
  }

  console.log(
    ONLY_CLEAN
      // Deliberately not a row count. Each figure above is a parent, and its
      // lines, take-offs, certificates and interactions went with it, so any
      // total printed here would be smaller than what was actually removed.
      ? `\nTest data removed.\n`
      : `\nWrote ${made} rows of test data, all marked "${MARK}" or coded "${P}…".\n` +
          // The command that undoes it depends on where it was loaded.
          (process.env.TEST_DATA_CONFIRM_HOST
            // node directly rather than `npm run … --`: PowerShell can drop
            // everything after the `--`, which is how a confirmed run once
            // arrived with no confirmation on it.
            ? `Remove it with:  node scripts/demo-data-uat.mjs --confirm-host=${process.env.TEST_DATA_CONFIRM_HOST} --clean\n`
            : `Remove it with:  npm run db:demo:clean\n`),
  );
} catch (err) {
  console.error("\n" + String(err?.stack ?? err));
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
