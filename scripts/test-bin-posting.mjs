/**
 * Bins against a real database (INV-14).
 *
 * The library rules are tested on their own in test-bins.mjs. What matters here
 * is that the movement seam actually applies them: a store that has bins
 * insists on one, a store without them carries on exactly as before, and a
 * transfer files material in the bin it is going INTO rather than the one it
 * came out of.
 */
import { importLibs } from "./lib-shim.mjs";

const libs = await importLibs(["stock-posting", "bins", "db"]);
const { db } = libs["db"];
const { recordMovement, transferStock, balanceFor } = libs["stock-posting"];
const { binQuantities, binLabel } = libs["bins"];

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  PASS ${name}${extra ? "  — " + extra : ""}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? "  — " + extra : ""}`); }
};
const today = () => new Date().toISOString().slice(0, 10);

const co = await db.company.findFirst({ where: { code: "WBE" } });
const job = await db.job.findFirst({ where: { companyId: co.id } });
const tag = `BIN-${Date.now()}`;

const held = async (itemId, storeId) =>
  binQuantities(await db.stockMovement.findMany({
    where: { companyId: co.id, itemId, storeId, binId: { not: null } },
    select: { binId: true, kind: true, quantity: true },
  }));

try {
  const item = await db.item.create({
    data: { companyId: co.id, code: `${tag}-CBL`, name: "16mm cable", unitCode: "MTR", category: "Cable" },
  });
  // One store with bins, one without, so both paths are exercised side by side.
  const binned = await db.store.create({
    data: { companyId: co.id, code: `${tag}-BIN`, name: "Binned store", kind: "Main store" },
  });
  const plain = await db.store.create({
    data: { companyId: co.id, code: `${tag}-PLN`, name: "Plain store", kind: "Site store" },
  });

  const rackA = await db.storageBin.create({
    data: { storeId: binned.id, code: "12", zone: "B", materialType: "Cable" },
  });
  const rackB = await db.storageBin.create({
    data: { storeId: binned.id, code: "13", zone: "B", materialType: "Consumables" },
  });

  ok("a store can be divided into bins", !!rackA && !!rackB);
  ok("  which are named by zone and code", binLabel(rackA) === "B / 12", binLabel(rackA));

  const move = (fields) =>
    recordMovement({ companyId: co.id, postedBy: "tester", date: today(), reference: tag, ...fields });

  /* =================================== a store without bins is unchanged == */
  {
    const res = await move({ kind: "Receipt", itemId: item.id, storeId: plain.id, quantity: 100, unitCost: 10 });
    ok("a store with no bins takes a movement with no bin", res.ok, res.ok ? "" : res.error);

    const stray = await move({
      kind: "Receipt", itemId: item.id, storeId: plain.id, quantity: 10, unitCost: 10, binId: rackA.id,
    });
    ok("  and refuses a bin belonging to another store", stray.ok === false);
    ok("  saying so plainly", /not in this store/.test(stray.error || ""), stray.error);
  }

  /* ========================================= a store with bins insists === */
  {
    const nameless = await move({ kind: "Receipt", itemId: item.id, storeId: binned.id, quantity: 100, unitCost: 10 });
    ok("a store with bins refuses a movement that names none", nameless.ok === false);
    ok("  and says why it matters",
      /bin totals agreeing with the shelf/.test(nameless.error || ""), nameless.error);

    const b = await balanceFor(co.id, item.id, binned.id);
    ok("  leaving the shelf untouched", b.quantity === 0, "a refused movement writes nothing");
  }

  /* ============================================== putting material away == */
  {
    const res = await move({
      kind: "Receipt", itemId: item.id, storeId: binned.id, quantity: 100, unitCost: 10, binId: rackA.id,
    });
    ok("material can be received into a bin", res.ok, res.ok ? "" : res.error);

    const row = await db.stockMovement.findUnique({ where: { id: res.movementId } });
    ok("  and the movement records which one", row.binId === rackA.id);

    const q = await held(item.id, binned.id);
    ok("  so the bin knows what it holds", q[rackA.id] === 100, String(q[rackA.id]));

    const b = await balanceFor(co.id, item.id, binned.id);
    ok("  and the shelf agrees with it", b.quantity === 100);
    ok("  valued per store, not per bin", b.value === 1000,
      "a bin answers where it is, not what it is worth");
  }

  /* ==================================== a bin cannot give what it has not = */
  {
    const tooMuch = await move({
      kind: "Issue", itemId: item.id, storeId: binned.id, quantity: 40, jobId: job.id, binId: rackB.id,
    });
    ok("issuing from a bin that has none of it is refused", tooMuch.ok === false);
    ok("  naming the bin", /bin B \/ 13/.test(tooMuch.error || ""), tooMuch.error);

    const fine = await move({
      kind: "Issue", itemId: item.id, storeId: binned.id, quantity: 40, jobId: job.id, binId: rackA.id,
    });
    ok("issuing from the bin that does have it works", fine.ok, fine.ok ? "" : fine.error);

    const q = await held(item.id, binned.id);
    ok("  and the bin comes down", q[rackA.id] === 60, String(q[rackA.id]));
  }

  {
    const over = await move({
      kind: "Issue", itemId: item.id, storeId: binned.id, quantity: 200, jobId: job.id, binId: rackA.id,
    });
    ok("issuing more than the bin holds is refused", over.ok === false);
    ok("  saying what it does hold", /holds 60 of 16mm cable, not 200/.test(over.error || ""), over.error);
  }

  /**
   * The wrong material type is recorded, not refused.
   */
  {
    const wrong = await move({
      kind: "Receipt", itemId: item.id, storeId: binned.id, quantity: 5, unitCost: 10, binId: rackB.id,
    });
    ok("cable put in the consumables bin is still recorded", wrong.ok, wrong.ok ? "" : wrong.error);
    ok("  because refusing it makes people stop recording bins at all",
      (await held(item.id, binned.id))[rackB.id] === 5);
  }

  /* ========================================================= transfers === */
  {
    const before = await held(item.id, binned.id);
    const res = await transferStock({
      companyId: co.id, postedBy: "tester", date: today(), reference: `${tag}-TR`,
      itemId: item.id, storeId: binned.id, binId: rackA.id,
      toStoreId: plain.id, quantity: 10,
    });
    ok("stock transfers out of a named bin", res.ok, res.ok ? "" : res.error);

    const after = await held(item.id, binned.id);
    ok("  taking it from that bin", after[rackA.id] === before[rackA.id] - 10,
      `${before[rackA.id]} -> ${after[rackA.id]}`);

    const arrival = await db.stockMovement.findUnique({ where: { id: res.in } });
    ok("  and arriving in the other store with no bin of its own",
      arrival.binId === null && arrival.storeId === plain.id,
      "the destination store is not divided into bins");
  }

  /**
   * The bug this was written to catch: carrying the source bin across would
   * file the arrival in a bin belonging to the store it just left.
   */
  {
    const second = await db.store.create({
      data: { companyId: co.id, code: `${tag}-TWO`, name: "Second binned store", kind: "Site store" },
    });
    const far = await db.storageBin.create({ data: { storeId: second.id, code: "1", zone: "A" } });

    const res = await transferStock({
      companyId: co.id, postedBy: "tester", date: today(), reference: `${tag}-TR2`,
      itemId: item.id, storeId: binned.id, binId: rackA.id,
      toStoreId: second.id, toBinId: far.id, quantity: 5,
    });
    ok("a transfer between two binned stores works", res.ok, res.ok ? "" : res.error);

    const arrival = await db.stockMovement.findUnique({ where: { id: res.in } });
    ok("  and lands in the destination's own bin", arrival.binId === far.id,
      "carrying the source bin across would file it in the store it just left");

    const q = await held(item.id, second.id);
    ok("  which then holds it", q[far.id] === 5, String(q[far.id]));
  }

  /* ============================================ what the store is called = */
  {
    const s = await db.store.findUnique({ where: { id: plain.id } });
    ok("a store knows what kind of place it is", s.kind === "Site store");
    const d = await db.store.create({ data: { companyId: co.id, code: `${tag}-DEF`, name: "Unsaid" } });
    ok("  defaulting to a main store when nobody said", d.kind === "Main store");
  }
} finally {
  const items = await db.item.findMany({
    where: { companyId: co.id, code: { startsWith: "BIN-" } }, select: { id: true },
  });
  const ids = items.map((i) => i.id);
  const rows = await db.stockMovement.findMany({
    where: { companyId: co.id, itemId: { in: ids } }, select: { id: true, entryId: true },
  });
  await db.stockMovement.deleteMany({ where: { companyId: co.id, itemId: { in: ids } } });
  for (const r of rows) {
    if (!r.entryId) continue;
    await db.journalLine.deleteMany({ where: { entryId: r.entryId } });
    await db.journalEntry.delete({ where: { id: r.entryId } }).catch(() => {});
  }
  await db.item.deleteMany({ where: { companyId: co.id, code: { startsWith: "BIN-" } } });
  await db.store.deleteMany({ where: { companyId: co.id, code: { startsWith: "BIN-" } } });
}

console.log(`\n${pass} passed, ${fail} failed`);
await db.$disconnect();
process.exit(fail ? 1 : 0);
