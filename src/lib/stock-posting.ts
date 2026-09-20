import "server-only";
import { db } from "./db";
import { documentStem, nextInSeries } from "./docnumber";
import { checkBin, binQuantities } from "./bins";
import { postVoucher } from "./posting";
import { accountsForPosting } from "./accounts";
import {
  balanceOf, priceReceipt, priceIssue, checkIssue, isInward,
  MOVEMENT_KINDS, type StockBalance,
} from "./stock";
import { goesBackToStock, checkReturn, RETURN_CONDITIONS } from "./returns";
import { serialised, shelfKey, seriesKey, jobItemKey, isUniqueClash, isBusy, BUSY_MESSAGE, type Client } from "./serialise";

/**
 * Turning a stock movement into accounting.
 *
 * What the ledger has to say
 * --------------------------
 * Material arriving is an asset, not a cost. It becomes a cost on the day it is
 * issued to a job, which is the day it stops being ours and starts being that
 * contract's. Getting this the wrong way round is what makes a month look
 * terrible because a delivery landed on the 30th, and the month after look
 * wonderful for the same reason.
 *
 * Receipt              inventory up, goods-received-not-invoiced up.
 *                      The supplier is owed even though nothing is billed yet.
 * Issue to a job       site materials up, tagged to the job; inventory down.
 * Return to store      the reverse of an issue, at the cost it went out at.
 * Return to supplier   inventory down, what is owed for it down with it.
 * Adjustment           inventory and site materials, with no job. Material
 *                      paid for that no contract ever received.
 * Transfer             nothing at all. Moving a drum of cable from the main
 *                      store to a site container changes where it is, not what
 *                      the company owns, so there is no voucher to write.
 *
 * Why an issue is priced here and not on the form
 * -----------------------------------------------
 * The weighted average moves every time something is received, so the price of
 * an issue depends on the moment it happens. Deciding it in the browser means
 * deciding it from a figure that may already be stale. It is read and applied
 * in the same place, against the movements as they stand.
 */

export type StockResult =
  | { ok: true; movementId: string; entryId: string | null; reference: string | null; unitCost: number; value: number }
  | { ok: false; error: string };

/** The movements for one item in one store — the ledger the shelf is read from. */
export async function balanceFor(companyId: string, itemId: string, storeId: string): Promise<StockBalance> {
  const movements = await db.stockMovement.findMany({
    where: { companyId, itemId, storeId },
    select: { kind: true, quantity: true, value: true, inspection: true },
  });
  return balanceOf(movements);
}

export type MovementInput = {
  companyId: string;
  postedBy: string;
  kind: string;
  itemId: string;
  storeId: string;
  date: string;
  quantity: number;
  /** Required on a receipt. Ignored on anything priced from the shelf. */
  unitCost?: number;
  jobId?: string | null;
  partyId?: string | null;
  reference: string;
  notes?: string | null;
  /** Which bin inside the store (INV-14). Required once the store has any. */
  binId?: string | null;
  /** The order line a delivery arrives against, stored with the row itself. */
  purchaseOrderLineId?: string | null;
};

export type MovementOptions = {
  /** More locks to hold while the movement is checked and written. */
  lockKeys?: string[];
  /**
   * A last check made while the locks are held, through the same client, just
   * before the row is written. Receiving against an order uses it to weigh the
   * delivery against what has arrived so far, so two deliveries cannot both be
   * weighed against the same figure.
   */
  guard?: (client: Client) => Promise<{ ok: true } | { ok: false; error: string }>;
};

/** Kinds whose value comes from what is already on the shelf. */
const PRICED_FROM_SHELF = new Set(["Issue", "Return to supplier", "Adjustment out", "Transfer out"]);

/**
 * Record a movement and post what it does to the books.
 *
 * The row is written first so the voucher has something to be tied to, and
 * removed again if the posting is refused — the same order the advances
 * register uses, and for the same reason.
 */
export async function recordMovement(input: MovementInput, options: MovementOptions = {}): Promise<StockResult> {
  const kind = String(input.kind);
  if (!(MOVEMENT_KINDS as readonly string[]).includes(kind)) {
    return { ok: false, error: "That is not a kind of stock movement." };
  }
  const reference = (input.reference ?? "").trim().slice(0, 120);
  if (!reference) return { ok: false, error: "Enter the delivery note, issue note or count sheet this comes from." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date ?? "")) return { ok: false, error: "Enter the date it moved." };

  const item = await db.item.findFirst({ where: { id: input.itemId, companyId: input.companyId } });
  if (!item) return { ok: false, error: "That item is not in this company." };
  const store = await db.store.findFirst({ where: { id: input.storeId, companyId: input.companyId } });
  if (!store) return { ok: false, error: "That store is not in this company." };

  if (!item.isStocked) {
    return {
      ok: false,
      error: `${item.name} is not a stocked item, so there is no shelf for it to move on or off. Charge it straight to the job on a supplier invoice instead.`,
    };
  }

  if (input.jobId && !(await db.job.findFirst({ where: { id: input.jobId, companyId: input.companyId } }))) {
    return { ok: false, error: "That job is not in this company." };
  }
  if (input.partyId && !(await db.party.findFirst({ where: { id: input.partyId, companyId: input.companyId } }))) {
    return { ok: false, error: "That supplier is not in this company." };
  }

  // An issue with no job is material walking out of the store to nowhere. It is
  // the single easiest way for a contract to look more profitable than it is.
  if (kind === "Issue" && !input.jobId) {
    return { ok: false, error: "Choose the job this material is going to. An issue with no job puts the cost on nothing." };
  }

  // INV-11: material that has to be inspected arrives on the shelf but is not
  // free to use until somebody has looked at it.
  const inspection = kind === "Receipt" && item.requiresInspection ? "Pending" : null;

  // The shelf is read and the movement written as one step, holding the lock
  // for this item in this store. Reading the balance and then writing, with
  // nothing between, let twenty-five simultaneous issues from a shelf of ten
  // all read "ten" and take the stock to minus fourteen. The voucher is posted
  // after the lock is released: it does not change what is on the shelf, and
  // holding the lock through it would queue every store user behind the ledger.
  const written = await serialised(
    [shelfKey(input.companyId, item.id, store.id), ...(options.lockKeys ?? [])],
    async (client) => {
      if (options.guard) {
        const guarded = await options.guard(client);
        if (!guarded.ok) return guarded;
      }

      // INV-14: a store either uses bins or does not, and that is decided by
      // whether any exist rather than by a setting somebody can leave set wrong.
      const bins = await client.storageBin.findMany({ where: { storeId: store.id } });
      const held = binQuantities(
        await client.stockMovement.findMany({
          where: { companyId: input.companyId, itemId: input.itemId, storeId: input.storeId, binId: { not: null } },
          select: { binId: true, kind: true, quantity: true },
        }),
      );
      const binOk = checkBin(
        bins, input.binId, kind, input.quantity, held[input.binId ?? ""] ?? 0, item.name,
      );
      if (!binOk.ok) return { ok: false as const, error: binOk.error };

      const balance = balanceOf(
        await client.stockMovement.findMany({
          where: { companyId: input.companyId, itemId: input.itemId, storeId: input.storeId },
          select: { kind: true, quantity: true, value: true, inspection: true },
        }),
      );

      let priced;
      if (PRICED_FROM_SHELF.has(kind)) {
        const permitted = checkIssue(input.quantity, balance, item.name);
        if (!permitted.ok) return { ok: false as const, error: permitted.error };
        priced = priceIssue(input.quantity, balance);
      } else {
        const cost = Number(input.unitCost);
        if (!Number.isFinite(cost) || cost < 0) return { ok: false as const, error: "Enter what one unit cost." };
        priced = priceReceipt(input.quantity, cost);
        if (priced.quantity <= 0) return { ok: false as const, error: "Enter how much arrived." };
      }

      const row = await client.stockMovement.create({
        data: {
          companyId: input.companyId,
          itemId: item.id,
          storeId: store.id,
          binId: input.binId || null,
          kind,
          inspection,
          date: new Date(input.date + "T00:00:00.000Z"),
          quantity: priced.quantity,
          unitCost: priced.unitCost,
          value: priced.value,
          jobId: input.jobId ?? null,
          partyId: input.partyId ?? null,
          purchaseOrderLineId: input.purchaseOrderLineId ?? null,
          reference,
          notes: input.notes ?? null,
          createdBy: input.postedBy,
        },
      });
      return { ok: true as const, row, priced };
    },
  ).catch((err) => {
    if (isBusy(err)) return { ok: false as const, error: BUSY_MESSAGE };
    throw err;
  });
  if (!written.ok) return written;
  const { row, priced } = written;

  // A transfer changes where stock is, not what the company owns, so there is
  // nothing to post. The movement is still recorded — the shelf moved.
  if (kind === "Transfer in" || kind === "Transfer out") {
    return { ok: true, movementId: row.id, entryId: null, reference: null, unitCost: priced.unitCost, value: priced.value };
  }

  const resolved = await accountsForPosting(input.companyId, [
    "inventory",
    kind === "Receipt" || kind === "Return to supplier" ? "goodsReceivedNotInvoiced" : "materialCost",
  ]);
  if (!resolved.ok) {
    await db.stockMovement.delete({ where: { id: row.id } });
    return { ok: false, error: resolved.error };
  }
  const inventory = resolved.ids.inventory;
  const counter = resolved.ids[kind === "Receipt" || kind === "Return to supplier" ? "goodsReceivedNotInvoiced" : "materialCost"];

  // Stock going up debits inventory; stock going down credits it. The other
  // side follows from which kind it is.
  const up = isInward(kind);
  const amount = priced.value;

  // Whatever happens to the posting — a refusal or a fault — a movement with no
  // voucher must not be left behind: the shelf and the ledger would disagree.
  let posted: Awaited<ReturnType<typeof postVoucher>>;
  try {
    posted = await postVoucher({
      companyId: input.companyId,
      postedBy: input.postedBy,
      voucherType: "Journal",
      date: input.date,
      partyId: input.partyId ?? null,
      memo: `${kind} — ${item.code} ${item.name} (${reference})`,
      lines: up
        ? [
            { accountId: inventory, debit: amount, credit: 0 },
            { accountId: counter, debit: 0, credit: amount, jobId: input.jobId ?? null },
          ]
        : [
            { accountId: counter, debit: amount, credit: 0, jobId: input.jobId ?? null },
            { accountId: inventory, debit: 0, credit: amount },
          ],
      sourceType: "stock-movement",
      sourceId: row.id,
      source: "stock",
    });
  } catch (err) {
    await db.stockMovement.delete({ where: { id: row.id } }).catch(() => {});
    throw err;
  }
  if (!posted.ok) {
    await db.stockMovement.delete({ where: { id: row.id } });
    return posted;
  }

  await db.stockMovement.update({ where: { id: row.id }, data: { entryId: posted.entryId } });
  return {
    ok: true,
    movementId: row.id,
    entryId: posted.entryId,
    reference: posted.reference,
    unitCost: priced.unitCost,
    value: priced.value,
  };
}

/**
 * Move stock between two stores.
 *
 * Written as a pair, because half a transfer is stock that has left one shelf
 * and arrived nowhere. Both rows carry the same reference so the two ends can
 * always be found together, and the second is priced at what the first took.
 */
export async function transferStock(
  input: Omit<MovementInput, "kind"> & { toStoreId: string; toBinId?: string | null },
): Promise<{ ok: true; out: string; in: string } | { ok: false; error: string }> {
  if (input.toStoreId === input.storeId) {
    return { ok: false, error: "Choose a different store to move it to." };
  }
  const to = await db.store.findFirst({ where: { id: input.toStoreId, companyId: input.companyId } });
  if (!to) return { ok: false, error: "That store is not in this company." };

  const out = await recordMovement({ ...input, kind: "Transfer out" });
  if (!out.ok) return out;

  const arrival = await recordMovement({
    ...input,
    kind: "Transfer in",
    storeId: to.id,
    // The bin it is going INTO, which is a different place from the one it came
    // out of. Carrying the source bin across would file it in a bin belonging
    // to the other store, and the two stores' totals would both be wrong.
    binId: input.toBinId ?? null,
    // At what it left the other shelf for, so value does not appear from nowhere.
    unitCost: out.unitCost,
  });
  if (!arrival.ok) {
    // Never leave stock in transit. The half that worked is undone.
    await db.stockMovement.delete({ where: { id: out.movementId } });
    return arrival;
  }
  return { ok: true, out: out.movementId, in: arrival.movementId };
}


/* ================================================ QA/QC inspection ====== */

export type InspectionInput = {
  movementId: string;
  inspectedBy: string;
  outcome: "Accepted" | "Rejected";
  note?: string | null;
};

/**
 * Pass or fail a delivery (INV-11).
 *
 * Nothing is posted either way. The material is already on the shelf and
 * already owned — the inspection decides whether it can be used, which is a
 * different question from whether it is there. Rejected material stays exactly
 * where it is and stays in the stock value, because it is still the company's
 * until it physically goes back, and a return to the supplier is the movement
 * that takes it away.
 *
 * An inspection is never revised. Changing a pass to a fail after material has
 * been issued would rewrite a decision somebody acted on, so it is recorded
 * once and corrected, if at all, by a fresh look at fresh material.
 */
export async function inspectReceipt(input: InspectionInput): Promise<StockResult> {
  const movement = await db.stockMovement.findUnique({
    where: { id: input.movementId },
    include: { item: true },
  });
  if (!movement) return { ok: false, error: "That delivery was not found." };
  if (movement.kind !== "Receipt") {
    return { ok: false, error: "Only a delivery can be inspected." };
  }
  if (!movement.inspection) {
    return {
      ok: false,
      error: `${movement.item.name} is not set to need inspection, so there is nothing to pass or fail. Turn that on for the item first.`,
    };
  }
  if (movement.inspection !== "Pending") {
    return {
      ok: false,
      error: `This delivery was already ${movement.inspection.toLowerCase()}${movement.inspectedBy ? ` by ${movement.inspectedBy}` : ""}. An inspection is recorded once.`,
    };
  }
  if (input.outcome !== "Accepted" && input.outcome !== "Rejected") {
    return { ok: false, error: "Say whether it passed or failed." };
  }

  await db.stockMovement.update({
    where: { id: movement.id },
    data: {
      inspection: input.outcome,
      inspectedBy: input.inspectedBy,
      inspectedAt: new Date(),
      inspectionNote: input.note ?? null,
    },
  });

  return {
    ok: true,
    movementId: movement.id,
    entryId: movement.entryId,
    reference: null,
    unitCost: movement.unitCost,
    value: movement.value,
  };
}

/** Deliveries still waiting on QA/QC. */
export async function awaitingInspection(companyId: string) {
  return db.stockMovement.findMany({
    where: { companyId, kind: "Receipt", inspection: "Pending" },
    include: {
      item: { select: { code: true, name: true, unitCode: true } },
      store: { select: { code: true, name: true } },
      party: { select: { name: true } },
    },
    orderBy: { date: "asc" },
  });
}


/* ============================== material coming back from site (INV-16) == */

export type ReturnLineInput = {
  itemId: string;
  condition: string;
  quantity: number;
  notes?: string | null;
  /**
   * Which bin the reusable material goes back into (INV-14).
   *
   * Per line rather than per note, because a lorry coming off site carries
   * cable, fittings and offcuts together and they do not go back on the same
   * shelf. Ignored on a scrap line, which never reaches a bin.
   */
  binId?: string | null;
};

export type ReturnInput = {
  companyId: string;
  postedBy: string;
  jobId: string;
  storeId: string;
  date: string;
  returnedBy: string;
  notes?: string | null;
  lines: ReturnLineInput[];
};

/** How much of an item a job was issued, and how much it has sent back. */
export async function jobPosition(companyId: string, jobId: string, itemId: string, client: Client = db) {
  const rows = await client.stockMovement.findMany({
    where: { companyId, jobId, itemId, kind: { in: ["Issue", "Return to store"] } },
    select: { kind: true, quantity: true },
  });
  let issued = 0;
  let returned = 0;
  for (const r of rows) {
    if (r.kind === "Issue") issued += r.quantity;
    else returned += r.quantity;
  }
  // Scrap never moved stock, so it has to be counted from the notes instead.
  //
  // A note still in Draft counts too. It is a claim on what the job has out:
  // its rows are written before its movements are, and until this counted them
  // two notes saved at the same instant could both be told the job still had
  // forty out and both return it. A note that fails to post is deleted, so the
  // claim goes with it.
  const scrapped = await client.materialReturnLine.aggregate({
    where: { itemId, condition: "Scrap", return: { companyId, jobId, status: { in: ["Draft", "Posted"] } } },
    _sum: { quantity: true },
  });
  return {
    issued: Math.round(issued * 1000) / 1000,
    returned: Math.round((returned + (scrapped._sum.quantity ?? 0)) * 1000) / 1000,
  };
}

/**
 * Post a material return note.
 *
 * Reusable lines go through recordMovement like any other return, so they are
 * priced, posted and credited to the job by the seam that already exists.
 * Scrap lines produce no movement at all: the job keeps the cost because it
 * caused it, and nothing enters the stock ledger because scrap is not stock.
 *
 * The whole note is checked before anything is written. Half a return note —
 * two lines back on the shelf and a third refused — leaves a job credited for
 * material the storekeeper is still holding.
 */
export type ReturnResult =
  | { ok: true; returnId: string; number: string }
  | { ok: false; error: string };

export async function postReturn(input: ReturnInput): Promise<ReturnResult> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date ?? "")) return { ok: false, error: "Enter the date it came back." };

  const job = await db.job.findFirst({ where: { id: input.jobId, companyId: input.companyId } });
  if (!job) return { ok: false, error: "Choose the job the material is coming back from." };
  const store = await db.store.findFirst({ where: { id: input.storeId, companyId: input.companyId } });
  if (!store) return { ok: false, error: "Choose the store the reusable material is going into." };
  // Who handed it over. Material reappearing on a shelf with nobody's name on
  // it is the one thing a stock count can never afterwards explain.
  if (!String(input.returnedBy ?? "").trim()) {
    return { ok: false, error: "Say who brought it back." };
  }

  const lines = input.lines.filter((l) => l.itemId && Number(l.quantity) > 0);
  if (!lines.length) return { ok: false, error: "Add at least one line saying what is coming back." };

  for (const l of lines) {
    if (!(RETURN_CONDITIONS as readonly string[]).includes(l.condition)) {
      return { ok: false, error: "Say whether each line is reusable or scrap." };
    }
  }

  // Everything is checked before anything is written.
  //
  // `claimed` is what makes the note add up as a whole rather than line by
  // line. The same item can appear twice — sixty reusable and forty scrap is
  // the ordinary case — and checking each line only against the job would let
  // two lines of sixty both pass against a hundred outstanding, then post a
  // hundred and twenty. Each line is therefore weighed against what the job
  // still has out AFTER the lines above it on this same note.
  const itemNames = new Map<string, string>();
  for (const l of lines) {
    const item = await db.item.findFirst({ where: { id: l.itemId, companyId: input.companyId } });
    if (!item) return { ok: false, error: "One of those items is not in this company." };
    itemNames.set(l.itemId, item.name);
  }

  /**
   * What this note asks of the job, weighed against what the job still has out.
   *
   * Run inside the lock on each (job, item) before the note is written, and
   * again inside the same lock before each movement — because a reusable line
   * only becomes visible to another note when its movement exists, and that
   * happens after the note row.
   */
  const askOf = async (client: Client, only?: { itemId: string; quantity: number }) => {
    const claimed = new Map<string, number>();
    for (const l of only ? [only] : lines) {
      const pos = await jobPosition(input.companyId, input.jobId, l.itemId, client);
      const already = claimed.get(l.itemId) ?? 0;
      const permitted = checkReturn(l.quantity, pos.issued, pos.returned + already, itemNames.get(l.itemId) ?? "this item");
      if (!permitted.ok) return permitted;
      claimed.set(l.itemId, already + Number(l.quantity));
    }
    return { ok: true as const };
  };

  // One lock per item on the note, in a fixed order (serialised sorts them), so
  // two notes for the same job queue rather than pass the same check.
  const jobLocks = [...new Set(lines.map((l) => jobItemKey(input.companyId, input.jobId, l.itemId)))];

  // Numbered while holding the series lock. There was no retry here at all, so
  // two returns saved at the same moment took the same number and the second
  // failed with a database error instead of a note.
  let refused: { ok: false; error: string } | null = null;
  const writeNote = async (client: Client) => {
    const allowed = await askOf(client);
    if (!allowed.ok) {
      refused = allowed;
      return null;
    }
    return client.materialReturn.create({
      data: {
        companyId: input.companyId,
        number: await nextReturnNumber(input.companyId, client),
        status: "Draft",
        jobId: job.id,
        storeId: store.id,
        date: new Date(input.date + "T00:00:00.000Z"),
        returnedBy: input.returnedBy,
        notes: input.notes ?? null,
        lines: {
          create: lines.map((l, i) => ({
            itemId: l.itemId,
            condition: l.condition,
            quantity: Number(l.quantity),
            value: 0,
            notes: l.notes ?? null,
            sortOrder: i + 1,
          })),
        },
      },
      include: { lines: true },
    });
  };
  let created: Awaited<ReturnType<typeof writeNote>> | null = null;
  for (let attempt = 0; attempt < 5 && !created && !refused; attempt++) {
    try {
      created = await serialised([...jobLocks, seriesKey(input.companyId, "MRN")], writeNote);
    } catch (e) {
      if (isBusy(e)) return { ok: false, error: BUSY_MESSAGE };
      if (!isUniqueClash(e)) throw e;
    }
  }
  if (refused) return refused;
  if (!created) return { ok: false, error: "Could not allocate a number. Try again." };

  /**
   * Which bin each line goes back into, by the sort order it was written with.
   *
   * The bin is not a column on the return line: it belongs to the movement,
   * which the line already points at, and storing it twice would give two
   * places for it to disagree. Matching on sortOrder rather than on array
   * position, because the rows come back in whatever order the database likes.
   */
  const binBySort = new Map(lines.map((l, i) => [i + 1, l.binId ?? null]));

  for (const l of created.lines) {
    if (!goesBackToStock(l.condition)) continue;

    const moved = await recordMovement({
      companyId: input.companyId,
      postedBy: input.postedBy,
      kind: "Return to store",
      itemId: l.itemId,
      storeId: store.id,
      date: input.date,
      quantity: l.quantity,
      // Priced at what the shelf says it is worth, so the job is credited the
      // same way it was charged.
      unitCost: (await balanceFor(input.companyId, l.itemId, store.id)).averageCost || 0,
      jobId: job.id,
      reference: created.number,
      notes: l.notes,
      binId: binBySort.get(l.sortOrder) ?? null,
    }, {
      // Held and checked together: the job's position is read and the movement
      // written as one step, so a note that slipped past the first check cannot
      // slip past this one.
      lockKeys: [jobItemKey(input.companyId, input.jobId, l.itemId)],
      guard: (client) => askOf(client, { itemId: l.itemId, quantity: l.quantity }),
    });
    if (!moved.ok) {
      // Undo the note rather than leave half of it posted.
      await db.materialReturn.delete({ where: { id: created.id } });
      return moved;
    }
    await db.materialReturnLine.update({
      where: { id: l.id },
      data: { movementId: moved.movementId, value: moved.value },
    });
  }

  await db.materialReturn.update({ where: { id: created.id }, data: { status: "Posted" } });
  return { ok: true, returnId: created.id, number: created.number };
}

async function nextReturnNumber(companyId: string, client: Client = db): Promise<string> {
  const company = await db.company.findUnique({ where: { id: companyId }, select: { code: true } });
  const stem = documentStem(company?.code ?? "", "MRN");
  const last = await client.materialReturn.findFirst({
    where: { companyId, number: { startsWith: stem } },
    orderBy: { number: "desc" },
    select: { number: true },
  });
  return nextInSeries(stem, last?.number);
}
