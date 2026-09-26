/**
 * Adding a master record without leaving the form that needed it.
 *
 * The client's complaint: typing a purchase order, finding the item is not in
 * the catalogue, and having to abandon the order, go to Items, add it, and
 * start again. So the item dialog opens over the order, and what it creates
 * lands on the line that asked for it.
 *
 * Three rules hold this together, and each is easy to break by accident:
 *
 *  1. A form element cannot be nested inside another. Every one of these
 *     screens IS a form, so the dialog has to be rendered outside it — after
 *     the closing tag, driven by state. Nested, the browser silently drops the
 *     inner form and the save button posts the wrong thing.
 *  2. The trigger only appears for somebody who may create that master.
 *     Procurement does not keep the supplier list; the person buying does not
 *     create the payee.
 *  3. The save hands back what it made, so the field can take it. Otherwise
 *     the new record exists but the form still shows an empty picker, and the
 *     person adds it twice.
 */
import fs from "node:fs";

let pass = 0, fail = 0;
const ok = (n, c, x = "") => { c ? pass++ : fail++; console.log(`  ${c ? "PASS" : "FAIL"} ${n}${x ? "  — " + x : ""}`); };
const read = (p) => fs.readFileSync(p, "utf8");

/* ===================== the dialogs can be opened by others ============== */

for (const [file, master] of [
  ["src/components/inventory/ItemForm.tsx", "item"],
  ["src/components/inventory/StoreForm.tsx", "store"],
  ["src/components/finance/PartyForm.tsx", "customer or supplier"],
]) {
  const src = read(file);
  ok(`the ${master} dialog can be opened by another form`, /controlled\s*=\s*false/.test(src) && /onClose\?/.test(src));
  ok(`  and tells the caller what it created`, /onCreated\?/.test(src));
}

/* ===================== what the actions hand back ======================= */

const inv = read("src/app/(app)/inventory/actions.ts");
ok("saving an item returns it, so the line can take it", /item: \{\s*id: created\.id/.test(inv));
ok("saving a store returns it", /store: \{ id: created\.id/.test(inv));
const parties = read("src/app/(app)/finance/parties/actions.ts");
ok("creating a party returns it", /party: \{ id: party\.id/.test(parties));

/* ============ the dialog is outside the form that opens it ============== */

const FORMS = [
  ["src/components/inventory/OrderForm.tsx", "purchase order", ["ItemForm", "StoreForm", "PartyForm"]],
  ["src/components/inventory/RequestForm.tsx", "material request", ["ItemForm"]],
  ["src/components/inventory/RfqForm.tsx", "enquiry", ["ItemForm"]],
  ["src/components/inventory/MovementForm.tsx", "receive & issue", ["ItemForm", "StoreForm", "PartyForm"]],
];

for (const [file, screen, dialogs] of FORMS) {
  const src = read(file);
  const closeForm = src.lastIndexOf("</form>");
  ok(`${screen}: the form closes before the dialogs open`, closeForm > 0);
  for (const dialog of dialogs) {
    const used = src.indexOf(`<${dialog}`);
    ok(`  ${dialog} is rendered outside the form`, used > closeForm,
      used < 0 ? "not rendered at all" : used > closeForm ? "" : "nested inside the form — the browser drops it");
  }
  ok(`  and every trigger asks permission first`,
    (src.match(/canAdd(Item|Store|Party) &&/g) || []).length >= dialogs.length,
    `${(src.match(/canAdd(Item|Store|Party) &&/g) || []).length} guarded triggers`);
}

/* ================= the permission is the master's own =================== */

const orders = read("src/app/(app)/inventory/orders/page.tsx");
ok("adding an item asks for the items screen, not the order screen",
  /canAddItem = can\(session, "inventory\.items", "create"\)/.test(orders));
ok("adding a supplier asks for the parties screen — the buyer does not create the payee",
  /canAddParty = can\(session, "finance\.parties", "create"\)/.test(orders));
ok("adding a store asks for the stores screen",
  /canAddStore = can\(session, "inventory\.stores", "create"\)/.test(orders));

/* ===================== what was deliberately left out =================== */

// A job is a contract: a code, a client, a budget, a start date. Created in
// passing from an order it gets a hurried code and no budget, and job costing
// is wrong from its first day. If this ever changes it should be a decision,
// not a copy-paste.
for (const [file, screen] of FORMS.map(([f, s]) => [f, s])) {
  const src = read(file);
  ok(`${screen}: no job is created in passing`, !/<JobForm/.test(src));
}

console.log("\n" + "=".repeat(50));
console.log(`INLINE MASTERS:  ${pass} passed, ${fail} failed  (${pass + fail} total)`);
console.log("=".repeat(50));
if (fail > 0) process.exit(1);
