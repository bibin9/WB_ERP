import "server-only";
import { db } from "./db";
import { documentStem, nextInSeries } from "./docnumber";
import {
  BID_UNITS, isLumpSum, materialPerUnit, summariseEstimate, checkQuotable,
  type BidLineLike, type Basis, type EstimateTotals,
} from "./estimating";

/**
 * Building an estimate: the bill of quantities, the takeoff, and the price.
 *
 * Posts nothing. An estimate is an opinion about what work will cost, and an
 * opinion is not a transaction — nothing is owed and nothing is owned because
 * somebody priced a job they have not won.
 *
 * The one thing this file insists on is that no selling price is ever stored.
 * Every figure a screen shows is computed from the build-up when it is asked
 * for. A stored total is a total that was true when somebody last pressed
 * save, and an estimate is edited twenty times before it goes out.
 */

export type Failed = { ok: false; error: string };
export type Result<T> = ({ ok: true } & T) | Failed;
export type Outcome = { ok: true } | Failed;

export const ESTIMATE_STATUSES = ["Draft", "Priced", "Quoted", "Superseded"] as const;

export const ESTIMATE_STATUS_HELP: Record<string, string> = {
  Draft: "Being built. Lines and prices are still moving.",
  Priced: "Finished and costed. Ready to turn into a quotation.",
  Quoted: "A quotation has gone out from this. It is the record of what was priced.",
  Superseded: "Replaced by a later estimate. Kept so the history still reads.",
};

async function nextEstimateNumber(companyId: string): Promise<string> {
  const company = await db.company.findUnique({ where: { id: companyId }, select: { code: true } });
  const stem = documentStem(company?.code ?? "", "EST");
  const last = await db.estimate.findFirst({
    where: { companyId, number: { startsWith: stem } },
    orderBy: { number: "desc" },
    select: { number: true },
  });
  return nextInSeries(stem, last?.number);
}

/* ============================================================== pricing == */

/** A stored estimate with everything the rules need to price it. */
export type StoredEstimate = {
  overheadPct: number;
  fixedCosts: number;
  basisKind: string;
  basisValue: number;
  acceptLoss: boolean;
  lines: {
    unit: string;
    quantity: number;
    materialCost: number;
    labourHours: number;
    labourRate: number;
    plantHours: number;
    plantRate: number;
    subcontractCost: number;
    takeoffs?: { perUnit: number; wastage: number; unitCost: number }[];
  }[];
};

/**
 * One stored line in the shape the rules read.
 *
 * Material comes from the takeoff whenever there is one. The stored
 * `materialCost` is only the fallback for lines nobody is going to measure —
 * a box of glands, a day's consumables — and the moment a takeoff exists it is
 * the takeoff that counts. Keeping both and hoping they agree is how a screen
 * ends up showing the wrong one.
 */
export function toBidLine(line: StoredEstimate["lines"][number]): BidLineLike {
  const takeoffs = line.takeoffs ?? [];
  return {
    unit: line.unit,
    quantity: line.quantity,
    build: {
      materialCost: takeoffs.length ? materialPerUnit(takeoffs) : line.materialCost,
      labourHours: line.labourHours,
      labourRate: line.labourRate,
      plantHours: line.plantHours,
      plantRate: line.plantRate,
      subcontractCost: line.subcontractCost,
    },
  };
}

export const basisOf = (e: { basisKind: string; basisValue: number }): Basis =>
  e.basisKind === "margin"
    ? { kind: "margin", value: e.basisValue }
    : { kind: "markup", value: e.basisValue };

/** What an estimate comes to, computed fresh every time it is asked for. */
export function priceEstimate(estimate: StoredEstimate): EstimateTotals {
  return summariseEstimate(
    estimate.lines.map(toBidLine),
    { overheadPct: estimate.overheadPct, fixedCosts: estimate.fixedCosts },
    basisOf(estimate),
  );
}

/** Everything a screen needs, in one read. */
export async function estimateWithTotals(id: string) {
  const estimate = await db.estimate.findUnique({
    where: { id },
    include: {
      lead: { select: { id: true, number: true, title: true, customerName: true } },
      lines: { include: { takeoffs: { orderBy: { sortOrder: "asc" } } }, orderBy: { sortOrder: "asc" } },
    },
  });
  if (!estimate) return null;
  return { estimate, totals: priceEstimate(estimate) };
}

/* ============================================================== raising == */

export type EstimateInput = {
  companyId: string;
  preparedBy: string;
  title: string;
  leadId?: string | null;
  overheadPct?: number;
  fixedCosts?: number;
  basisKind?: string;
  basisValue?: number;
  notes?: string | null;
};

export async function createEstimate(
  input: EstimateInput,
): Promise<Result<{ estimateId: string; number: string }>> {
  const title = String(input.title ?? "").trim();
  if (!title) return { ok: false, error: "Say what is being priced." };

  if (input.leadId && !(await db.lead.findFirst({ where: { id: input.leadId, companyId: input.companyId } }))) {
    return { ok: false, error: "That enquiry is not in this company." };
  }
  const pct = Number(input.overheadPct ?? 0);
  if (pct < 0) return { ok: false, error: "Overhead cannot be negative." };
  if (Number(input.fixedCosts ?? 0) < 0) return { ok: false, error: "Fixed costs cannot be negative." };

  for (let attempt = 0; attempt < 5; attempt++) {
    const number = await nextEstimateNumber(input.companyId);
    try {
      const created = await db.estimate.create({
        data: {
          companyId: input.companyId,
          number,
          title: title.slice(0, 300),
          status: "Draft",
          leadId: input.leadId || null,
          overheadPct: pct,
          fixedCosts: Number(input.fixedCosts) || 0,
          basisKind: input.basisKind === "margin" ? "margin" : "markup",
          basisValue: Number(input.basisValue) || 0,
          preparedBy: input.preparedBy,
          notes: input.notes ?? null,
        },
      });
      return { ok: true, estimateId: created.id, number };
    } catch (e) {
      if ((e as { code?: string })?.code !== "P2002") throw e;
    }
  }
  return { ok: false, error: "Could not allocate a number. Try again." };
}

/* ================================================================ lines == */

export type LineInput = {
  estimateId: string;
  id?: string | null;
  ref?: string | null;
  description: string;
  unit: string;
  quantity?: number;
  materialCost?: number;
  labourHours?: number;
  labourRate?: number;
  plantHours?: number;
  plantRate?: number;
  subcontractCost?: number;
  notes?: string | null;
};

export async function saveLine(input: LineInput): Promise<Result<{ lineId: string }>> {
  const estimate = await db.estimate.findUnique({ where: { id: input.estimateId } });
  if (!estimate) return { ok: false, error: "Not found" };
  if (estimate.status === "Superseded") {
    return { ok: false, error: "This estimate has been superseded. Edit the one that replaced it." };
  }

  const description = String(input.description ?? "").trim();
  if (!description) return { ok: false, error: "Say what the line is for." };
  if (!(BID_UNITS as readonly string[]).includes(input.unit)) {
    return { ok: false, error: "Choose how this line is measured." };
  }

  // A lump sum is one price for the package. Storing a quantity would invite
  // somebody to multiply by it later and turn an outcome back into a rate.
  const quantity = isLumpSum(input.unit) ? 1 : Number(input.quantity) || 0;
  if (!isLumpSum(input.unit) && quantity <= 0) {
    return { ok: false, error: "Enter how much of it there is." };
  }
  for (const [label, value] of [
    ["Material", input.materialCost], ["Labour hours", input.labourHours],
    ["A labour rate", input.labourRate], ["Plant hours", input.plantHours],
    ["A plant rate", input.plantRate], ["Subcontract", input.subcontractCost],
  ] as const) {
    if (Number(value ?? 0) < 0) return { ok: false, error: `${label} cannot be negative.` };
  }

  const data = {
    ref: input.ref ?? null,
    description: description.slice(0, 500),
    unit: input.unit,
    quantity,
    materialCost: Number(input.materialCost) || 0,
    labourHours: Number(input.labourHours) || 0,
    labourRate: Number(input.labourRate) || 0,
    plantHours: Number(input.plantHours) || 0,
    plantRate: Number(input.plantRate) || 0,
    subcontractCost: Number(input.subcontractCost) || 0,
    notes: input.notes ?? null,
  };

  if (input.id) {
    const existing = await db.estimateLine.findFirst({ where: { id: input.id, estimateId: input.estimateId } });
    if (!existing) return { ok: false, error: "That line is not on this estimate." };
    await db.estimateLine.update({ where: { id: input.id }, data });
    return { ok: true, lineId: input.id };
  }

  const last = await db.estimateLine.findFirst({
    where: { estimateId: input.estimateId },
    orderBy: { sortOrder: "desc" },
    select: { sortOrder: true },
  });
  const created = await db.estimateLine.create({
    data: { estimateId: input.estimateId, ...data, sortOrder: (last?.sortOrder ?? 0) + 1 },
  });
  return { ok: true, lineId: created.id };
}

export async function removeLine(lineId: string): Promise<Outcome> {
  const line = await db.estimateLine.findUnique({ where: { id: lineId }, include: { estimate: true } });
  if (!line) return { ok: false, error: "Not found" };
  if (line.estimate.status === "Quoted") {
    return {
      ok: false,
      error: "A quotation has gone out from this estimate. Copy it and change the copy, so the priced record still reads.",
    };
  }
  await db.estimateLine.delete({ where: { id: lineId } });
  return { ok: true };
}

/* ============================================================= takeoffs == */

export type TakeoffInput = {
  lineId: string;
  id?: string | null;
  itemId?: string | null;
  description: string;
  unitCode?: string;
  perUnit: number;
  wastage?: number;
  unitCost?: number;
};

export async function saveTakeoff(input: TakeoffInput): Promise<Result<{ takeoffId: string }>> {
  const line = await db.estimateLine.findUnique({ where: { id: input.lineId }, include: { estimate: true } });
  if (!line) return { ok: false, error: "Not found" };
  if (line.estimate.status === "Superseded") {
    return { ok: false, error: "This estimate has been superseded." };
  }

  const description = String(input.description ?? "").trim();
  if (!description) return { ok: false, error: "Say what material it is." };
  if (Number(input.perUnit) <= 0) {
    return { ok: false, error: "Say how much of it one unit needs." };
  }
  if (Number(input.unitCost ?? 0) < 0) return { ok: false, error: "A cost cannot be negative." };

  // Negative wastage would mean buying less than the drawings need.
  const wastage = Math.max(0, Number(input.wastage) || 0);
  if (wastage > 1) {
    return { ok: false, error: "That is more than a hundred per cent wastage. Enter it as a fraction — 0.05 for five per cent." };
  }

  const data = {
    itemId: input.itemId || null,
    description: description.slice(0, 300),
    unitCode: input.unitCode || "EA",
    perUnit: Number(input.perUnit),
    wastage,
    unitCost: Number(input.unitCost) || 0,
  };

  if (input.id) {
    const existing = await db.takeoffLine.findFirst({ where: { id: input.id, lineId: input.lineId } });
    if (!existing) return { ok: false, error: "That takeoff is not on this line." };
    await db.takeoffLine.update({ where: { id: input.id }, data });
    return { ok: true, takeoffId: input.id };
  }

  const last = await db.takeoffLine.findFirst({
    where: { lineId: input.lineId },
    orderBy: { sortOrder: "desc" },
    select: { sortOrder: true },
  });
  const created = await db.takeoffLine.create({
    data: { lineId: input.lineId, ...data, sortOrder: (last?.sortOrder ?? 0) + 1 },
  });
  return { ok: true, takeoffId: created.id };
}

export async function removeTakeoff(takeoffId: string): Promise<Outcome> {
  const t = await db.takeoffLine.findUnique({ where: { id: takeoffId } });
  if (!t) return { ok: false, error: "Not found" };
  await db.takeoffLine.delete({ where: { id: takeoffId } });
  return { ok: true };
}

/* ============================================================ the price == */

export type BasisInput = {
  estimateId: string;
  overheadPct?: number;
  fixedCosts?: number;
  basisKind?: string;
  basisValue?: number;
  acceptLoss?: boolean;
};

export async function setBasis(input: BasisInput): Promise<Outcome> {
  const estimate = await db.estimate.findUnique({ where: { id: input.estimateId } });
  if (!estimate) return { ok: false, error: "Not found" };
  if (estimate.status === "Superseded") return { ok: false, error: "This estimate has been superseded." };

  const pct = Number(input.overheadPct ?? estimate.overheadPct);
  if (pct < 0) return { ok: false, error: "Overhead cannot be negative." };
  const fixed = Number(input.fixedCosts ?? estimate.fixedCosts);
  if (fixed < 0) return { ok: false, error: "Fixed costs cannot be negative." };

  const kind = input.basisKind === "margin" ? "margin" : input.basisKind === "markup" ? "markup" : estimate.basisKind;
  const value = Number(input.basisValue ?? estimate.basisValue);
  if (kind === "margin" && value >= 1) {
    return {
      ok: false,
      error: "A hundred per cent margin would mean a price that is all profit and no cost. Enter it as a fraction — 0.2 for twenty per cent.",
    };
  }

  await db.estimate.update({
    where: { id: input.estimateId },
    data: {
      overheadPct: pct,
      fixedCosts: fixed,
      basisKind: kind,
      basisValue: value,
      acceptLoss: input.acceptLoss ?? estimate.acceptLoss,
    },
  });
  return { ok: true };
}

/**
 * Mark an estimate finished and fit to quote from.
 *
 * The check is the same one the screen shows while it is being built, applied
 * again here — a rule enforced only in a browser is a suggestion.
 */
export async function markPriced(estimateId: string): Promise<Outcome> {
  const held = await estimateWithTotals(estimateId);
  if (!held) return { ok: false, error: "Not found" };
  if (held.estimate.status === "Quoted") return { ok: false, error: "A quotation has already gone out from this." };

  const fit = checkQuotable(held.totals, held.estimate.acceptLoss);
  if (!fit.ok) return fit;

  await db.estimate.update({ where: { id: estimateId }, data: { status: "Priced" } });
  return { ok: true };
}

/** Estimates still being worked on. */
export async function openEstimates(companyId: string) {
  return db.estimate.findMany({
    where: { companyId, status: { in: ["Draft", "Priced"] } },
    include: { lines: { include: { takeoffs: true } } },
    orderBy: { createdAt: "desc" },
  });
}
