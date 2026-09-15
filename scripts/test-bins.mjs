/**
 * Zones and bins (INV-14).
 *
 * Three rules carry this document:
 *   - a store either uses bins or does not, decided by whether any exist;
 *   - a bin cannot give out more than it holds, the shelf rule one level down;
 *   - the wrong material type warns and does not refuse, because a rule that
 *     stops a storeman working stops the bins being recorded at all.
 */
import { importLibs } from "./lib-shim.mjs";
import fs from "node:fs";

const { bins: lib } = await importLibs(["bins"]);
const {
  STORE_KINDS, STORE_KIND_HELP,
  binLabel, binQuantities, storeUsesBins, checkBin, binMismatch, summariseBins, binVerdict,
} = lib;

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  PASS ${name}${extra ? "  — " + extra : ""}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? "  — " + extra : ""}`); }
};
const prose = (p) => fs.readFileSync(p, "utf8").replace(/^\s*\*\s?/gm, " ").replace(/\s+/g, " ");

const bin = (id, code, extra = {}) => ({ id, code, ...extra });

/* ================================================== what the words mean == */

ok("every kind of store is explained in plain English",
  STORE_KINDS.every((k) => (STORE_KIND_HELP[k] || "").length > 30), STORE_KINDS.join(", "));

/* ======================================================== what it is called */

ok("a bin in a zone is named by both", binLabel(bin("1", "12", { zone: "B" })) === "B / 12",
  "a bin number alone is ambiguous the moment a second zone exists");
ok("a bin with no zone is named by itself", binLabel(bin("1", "12")) === "12");
ok("  and blank whitespace is not a zone", binLabel(bin("1", "12", { zone: "  " })) === "12");

/* =========================================== what is in each bin === */

{
  const q = binQuantities([
    { binId: "a", kind: "Receipt", quantity: 100 },
    { binId: "a", kind: "Issue", quantity: 30 },
    { binId: "b", kind: "Receipt", quantity: 50 },
    { binId: null, kind: "Receipt", quantity: 999 },
  ]);
  ok("a bin's quantity comes from its movements", q.a === 70, String(q.a));
  ok("  each bin on its own", q.b === 50);
  ok("  and a movement with no bin belongs to none of them", q["null"] === undefined && q[""] === undefined,
    "it still counts on the shelf, which is where valuation lives");
}

ok("returns to store put material back in a bin",
  binQuantities([{ binId: "a", kind: "Return to store", quantity: 40 }]).a === 40);
ok("transfers out take it away",
  binQuantities([{ binId: "a", kind: "Receipt", quantity: 40 }, { binId: "a", kind: "Transfer out", quantity: 15 }]).a === 25);

/* ================================== a store either uses bins or does not = */

ok("a store with no bins does not use them", storeUsesBins([]) === false);
ok("a store with one bin does", storeUsesBins([bin("a", "1")]) === true);
ok("  and a store whose only bin is retired does not",
  storeUsesBins([bin("a", "1", { isActive: false })]) === false,
  "turning bins off is removing the last one; there is no switch to leave wrong");

/* ============================================ what a movement may name == */

const twoBins = [bin("a", "12", { zone: "B" }), bin("b", "13", { zone: "B" })];

ok("a store without bins needs none named",
  checkBin([], null, "Receipt", 10).ok === true);

{
  const r = checkBin([], "somewhere", "Receipt", 10);
  ok("a store without bins refuses a bin from elsewhere", r.ok === false,
    "naming another store's bin is how stock goes missing on paper");
  ok("  and says so", /not in this store/.test(r.error), r.error);
}

{
  const r = checkBin(twoBins, null, "Receipt", 10);
  ok("a store with bins insists one is named", r.ok === false);
  ok("  and says why it matters",
    /stops the bin totals agreeing with the shelf/.test(r.error), r.error);
}

ok("putting material into a bin needs nothing in it",
  checkBin(twoBins, "a", "Receipt", 10, 0).ok === true,
  "an inward movement is what puts the first of it there");

{
  const r = checkBin(twoBins, "a", "Issue", 10, 0, "16mm cable");
  ok("taking from an empty bin is refused", r.ok === false);
  ok("  naming the bin and the item", /none of 16mm cable in bin B \/ 12/.test(r.error), r.error);
}

{
  const r = checkBin(twoBins, "a", "Issue", 60, 40, "16mm cable");
  ok("taking more than a bin holds is refused", r.ok === false);
  ok("  saying what it does hold", /holds 40 of 16mm cable, not 60/.test(r.error), r.error);
  ok("  and what to do instead", /another bin, or count this one/.test(r.error), r.error);
}

ok("taking exactly what a bin holds is allowed", checkBin(twoBins, "a", "Issue", 40, 40).ok === true);
ok("a bin in another store is refused", checkBin(twoBins, "zzz", "Issue", 1, 100).ok === false);
ok("a retired bin cannot be used",
  checkBin([bin("a", "1"), bin("b", "2", { isActive: false })], "b", "Receipt", 5).ok === false);

/* ================================ the wrong material type warns, not refuses */

const cableBin = bin("a", "12", { zone: "B", materialType: "Cable" });

ok("the right material type says nothing", binMismatch(cableBin, "Cable") === "");
ok("  whatever the case", binMismatch(cableBin, "cable") === "");
ok("a bin with no declared type says nothing", binMismatch(bin("a", "1"), "Cable") === "");
ok("an item with no category says nothing", binMismatch(cableBin, null) === "");

{
  const w = binMismatch(cableBin, "Consumables");
  ok("the wrong material type warns", w.length > 0, w);
  ok("  naming both", /meant for Cable/.test(w) && /this is Consumables/.test(w), w);
  ok("  and saying it will still be recorded", /recorded either way/.test(w),
    "refuse them and they stop recording bins at all");
}

/**
 * The rule this one is deliberately NOT.
 */
ok("a mismatch is never a refusal",
  checkBin([cableBin], "a", "Receipt", 10).ok === true,
  "checkBin does not consult the material type at all");

/* ======================================================== the summary === */

{
  const list = [
    bin("a", "1", { zone: "A" }), bin("b", "2", { zone: "A" }),
    bin("c", "3", { zone: "B" }), bin("d", "4", { isActive: false, zone: "C" }),
  ];
  const t = summariseBins(list, { a: 100, c: 5 });
  ok("the summary counts live bins only", t.bins === 3, String(t.bins));
  ok("  and their zones", t.zones === 2, String(t.zones));
  ok("  which are in use", t.used === 2);
  ok("  and which are empty", t.empty === 1);
}

/* ======================================================== the sentence == */

ok("a store with no bins says how to start",
  /not divided into bins/.test(binVerdict([], {})) && /Add one/.test(binVerdict([], {})));

{
  const v = binVerdict([bin("a", "1", { zone: "A" }), bin("b", "2", { zone: "B" })], { a: 10 });
  ok("the sentence counts bins and zones", /2 bins across 2 zones/.test(v), v);
  ok("  and what is in them", /1 holding something, 1 empty/.test(v), v);
}

ok("bins with no zone are described as such",
  /none in a named zone/.test(binVerdict([bin("a", "1")], {})));
ok("a store where nothing is put away says so",
  /Nothing has been put away yet/.test(binVerdict([bin("a", "1", { zone: "A" })], {})));

/* ==================================================== how it is written = */

const src = prose("src/lib/bins.ts");
ok("the file says a bin is not an accounting dimension",
  /not an accounting dimension/.test(src) && /what is it worth/.test(src));
ok("and why half-binned stock is worse than none",
  /half-binned stock is worse than none/.test(src));
ok("and why the material type only warns",
  /no location data is worse than imperfect location data/.test(src));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
