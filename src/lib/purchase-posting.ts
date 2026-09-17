import "server-only";
import { db } from "./db";
import { documentStem, nextInSeries } from "./docnumber";
import { serialised, orderLineKey, seriesKey, isUniqueClash, isBusy, BUSY_MESSAGE, type Client } from "./serialise";
import { resolveRoute } from "./approval-engine";
import { recordMovement } from "./stock-posting";
import { toFils } from "./money";
import {
  orderTotal, lineTotal, statusFromReceipts, checkReceipt, RECEIVABLE, CLOSED,
} from "./purchasing";

/**
 * Raising, approving and receiving purchase orders.
 *
 * An order posts nothing to the ledger. It is a commitment to buy, and a
 * commitment is not a transaction: nothing has been delivered, nothing is owed,
 * and the accounts should say so. The money only moves when material arrives,
 * which is a stock receipt and goes through the seam that already exists.
 *
 * Where approval lives
 * --------------------
 * In the approvals module, not here. This raises a request through the route
 * the tenant already configured and then mirrors whatever that request decides.
 * The approval is the source of truth and the order follows it, so an approval
 * granted in the inbox cannot fail to reach the order, and the order can never
 * claim an approval the inbox does not have.
 *
 * That mirroring happens on read as well as on write. Nothing has to fire at
 * the right moment for the two to agree.
 */

export type Failed = { ok: false; error: string };
export type Result<T> = ({ ok: true } & T) | Failed;
/** A result that carries nothing back but whether it worked. */
export type Outcome = { ok: true } | Failed;

/**
 * The next number in a series.
 *
 * Scoped to the company and the year, like every other document in this system.
 * A clash is retried rather than assumed away, because two storekeepers raising
 * a request in the same second is exactly the case that would otherwise produce
 * one document with two numbers.
 */
async function nextNumber(companyId: string, prefix: string, client: Client = db): Promise<string> {
  const company = await db.company.findUnique({ where: { id: companyId }, select: { code: true } });
  const stem = documentStem(company?.code ?? "", prefix);

  const table = prefix === "MR" ? client.materialRequest : client.purchaseOrder;
  const last = await (table as typeof db.purchaseOrder).findFirst({
    where: { companyId, number: { startsWith: stem } },
    orderBy: { number: "desc" },
    select: { number: true },
  });
  return nextInSeries(stem, last?.number);
}

/* ====================================================== material request = */

export type RequestLineInput = { itemId?: string | null; description: string; unitCode?: string; quantity: number; notes?: string | null };

export type RequestInput = {
  companyId: string;
  requestedBy: string;
  jobId?: string | null;
  storeId?: string | null;
  neededBy?: string | null;
  notes?: string | null;
  lines: RequestLineInput[];
};

export async function createRequest(
  input: RequestInput & { tenantId?: string },
): Promise<Result<{ requestId: string; number: string }>> {
  const lines = input.lines.filter((l) => (l.description ?? "").trim() && Number(l.quantity) > 0);
  if (!lines.length) return { ok: false, error: "Add at least one line saying what is needed and how much." };

  if (input.jobId && !(await db.job.findFirst({ where: { id: input.jobId, companyId: input.companyId } }))) {
    return { ok: false, error: "That job is not in this company." };
  }

  // The number is read and used while holding the series lock, so people
  // raising requests at the same moment queue for a moment instead of
  // colliding. The retry stays for anything that numbers without the lock.
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const { created, number } = await serialised([seriesKey(input.companyId, "MR")], async (client) => {
        const number = await nextNumber(input.companyId, "MR", client);
        const created = await client.materialRequest.create({
        data: {
          companyId: input.companyId,
          number,
          status: "Draft",
          jobId: input.jobId ?? null,
          storeId: input.storeId ?? null,
          neededBy: input.neededBy ? new Date(input.neededBy + "T00:00:00.000Z") : null,
          requestedBy: input.requestedBy,
          notes: input.notes ?? null,
          lines: {
            create: lines.map((l, i) => ({
              itemId: l.itemId || null,
              description: l.description.trim().slice(0, 300),
              unitCode: l.unitCode || "EA",
              quantity: Number(l.quantity),
              notes: l.notes ?? null,
              order: i + 1,
            })),
          },
        },
        });
        return { created, number };
      });
      // INV-03: straight into the approval route, so a request is seen by the
      // people the client named rather than landing in procurement unreviewed.
      if (input.tenantId) await submitRequest(created.id, input.tenantId, input.requestedBy);
      return { ok: true, requestId: created.id, number };
    } catch (e) {
      // Somebody numbered without the lock. Take the next one rather than fail.
      if (isBusy(e)) return { ok: false, error: BUSY_MESSAGE };
      if (!isUniqueClash(e)) throw e;
    }
  }
  return { ok: false, error: "Could not allocate a number. Try again." };
}

/**
 * Send a material request for approval (INV-03).
 *
 * Site In-Charge, then Project Manager, then Procurement — the route the client
 * named, configurable afterwards like every other. Procurement is last because
 * it acts on the request rather than outranking it.
 *
 * A request carries no value, so no threshold applies and every step is taken.
 */
export async function submitRequest(requestId: string, tenantId: string, by: string): Promise<Outcome> {
  const request = await db.materialRequest.findUnique({ where: { id: requestId }, include: { lines: true } });
  if (!request) return { ok: false, error: "Not found" };
  if (request.status !== "Draft") {
    return { ok: false, error: `This request is ${request.status.toLowerCase()}, so it cannot be sent again.` };
  }
  if (!request.lines.length) return { ok: false, error: "A request with no lines cannot be approved." };

  const route = await resolveRoute(tenantId, "Material Request", null);
  const approval = await db.approvalRequest.create({
    data: {
      companyId: request.companyId,
      docType: "Material Request",
      title: `${request.number} — ${request.lines.length} line${request.lines.length === 1 ? "" : "s"}`,
      requestedBy: by,
      status: "Pending",
      currentStep: 1,
      steps: {
        create: route.map((r, i) => ({ order: i + 1, roleName: r.role, requiredLevel: r.level, status: "Pending" })),
      },
    },
  });

  await db.materialRequest.update({
    where: { id: requestId },
    data: { status: "Submitted", approvalRequestId: approval.id },
  });
  return { ok: true };
}

/** Bring a request into line with the approval it is waiting on. */
export async function syncRequestApproval(requestId: string): Promise<string> {
  const request = await db.materialRequest.findUnique({ where: { id: requestId } });
  if (!request?.approvalRequestId || request.status !== "Submitted") return request?.status ?? "";

  const approval = await db.approvalRequest.findUnique({ where: { id: request.approvalRequestId } });
  const status = approval?.status === "Approved" ? "Approved" : approval?.status === "Rejected" ? "Rejected" : request.status;
  if (status !== request.status) {
    await db.materialRequest.update({ where: { id: requestId }, data: { status } });
  }
  return status;
}

/* ======================================================== purchase order = */

export type OrderLineInput = {
  itemId?: string | null;
  description: string;
  unitCode?: string;
  quantity: number;
  unitPrice: number;
  jobId?: string | null;
};

export type OrderInput = {
  companyId: string;
  raisedBy: string;
  partyId: string;
  jobId?: string | null;
  storeId?: string | null;
  requestId?: string | null;
  date: string;
  expectedDate?: string | null;
  notes?: string | null;
  lines: OrderLineInput[];
};

export async function createOrder(input: OrderInput): Promise<Result<{ orderId: string; number: string }>> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date ?? "")) return { ok: false, error: "Enter the date of the order." };

  const party = await db.party.findFirst({ where: { id: input.partyId, companyId: input.companyId } });
  if (!party) return { ok: false, error: "Choose the supplier this order is going to." };

  const lines = input.lines.filter((l) => (l.description ?? "").trim() && Number(l.quantity) > 0);
  if (!lines.length) return { ok: false, error: "Add at least one line saying what is being ordered." };
  if (lines.some((l) => Number(l.unitPrice) < 0)) return { ok: false, error: "A price cannot be negative." };

  if (input.jobId && !(await db.job.findFirst({ where: { id: input.jobId, companyId: input.companyId } }))) {
    return { ok: false, error: "That job is not in this company." };
  }
  if (input.storeId && !(await db.store.findFirst({ where: { id: input.storeId, companyId: input.companyId } }))) {
    return { ok: false, error: "That store is not in this company." };
  }

  const priced = lines.map((l) => ({ ...l, ...lineTotal({ description: l.description, quantity: l.quantity, unitPrice: l.unitPrice }) }));
  const total = toFils(orderTotal(priced));

  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const { created, number } = await serialised([seriesKey(input.companyId, "PO")], async (client) => {
        const number = await nextNumber(input.companyId, "PO", client);
        const created = await client.purchaseOrder.create({
        data: {
          companyId: input.companyId,
          number,
          status: "Draft",
          partyId: party.id,
          partyName: party.name,
          jobId: input.jobId ?? null,
          storeId: input.storeId ?? null,
          requestId: input.requestId ?? null,
          date: new Date(input.date + "T00:00:00.000Z"),
          expectedDate: input.expectedDate ? new Date(input.expectedDate + "T00:00:00.000Z") : null,
          total,
          raisedBy: input.raisedBy,
          notes: input.notes ?? null,
          lines: {
            create: priced.map((l, i) => ({
              itemId: l.itemId || null,
              description: l.description.trim().slice(0, 300),
              unitCode: l.unitCode || "EA",
              quantity: l.quantity,
              unitPrice: l.unitPrice,
              netAmount: l.netAmount,
              jobId: l.jobId || null,
              sortOrder: i + 1,
            })),
          },
        },
        });
        return { created, number };
      });
      if (input.requestId) {
        await db.materialRequest.update({ where: { id: input.requestId }, data: { status: "Ordered" } });
      }
      return { ok: true, orderId: created.id, number };
    } catch (e) {
      if (isBusy(e)) return { ok: false, error: BUSY_MESSAGE };
      if (!isUniqueClash(e)) throw e;
    }
  }
  return { ok: false, error: "Could not allocate a number. Try again." };
}

/**
 * Send an order for approval.
 *
 * The route is resolved from the order's own total, so the value thresholds the
 * tenant configured decide who has to sign. The total is frozen on the order
 * before this, which is what stops the required approver changing under the
 * person being asked to approve.
 */
export async function submitOrder(orderId: string, tenantId: string, by: string): Promise<Result<{ approvalId: string }>> {
  const order = await db.purchaseOrder.findUnique({ where: { id: orderId }, include: { lines: true } });
  if (!order) return { ok: false, error: "Not found" };
  if (order.status !== "Draft") {
    return { ok: false, error: `This order is ${order.status.toLowerCase()}, so it cannot be sent for approval again.` };
  }
  if (!order.lines.length) return { ok: false, error: "An order with no lines cannot be approved." };

  const route = await resolveRoute(tenantId, "Purchase Order", order.total);
  const request = await db.approvalRequest.create({
    data: {
      companyId: order.companyId,
      docType: "Purchase Order",
      title: `${order.number} — ${order.partyName}`,
      amount: order.total,
      currency: order.currency,
      requestedBy: by,
      status: "Pending",
      currentStep: 1,
      steps: {
        create: route.map((r, i) => ({ order: i + 1, roleName: r.role, requiredLevel: r.level, status: "Pending" })),
      },
    },
  });

  await db.purchaseOrder.update({
    where: { id: orderId },
    data: { status: "Awaiting approval", approvalRequestId: request.id },
  });
  return { ok: true, approvalId: request.id };
}

/**
 * Bring an order into line with the approval it is waiting on.
 *
 * Called on read as well as on write, so the two cannot drift. Nothing has to
 * fire at the right moment: whoever looks next sees the truth.
 */
export async function syncOrderApproval(orderId: string): Promise<string> {
  const order = await db.purchaseOrder.findUnique({
    where: { id: orderId },
    include: { lines: { include: { receipts: { select: { quantity: true } } } } },
  });
  if (!order) return "";

  let status = order.status;

  if (order.approvalRequestId && status === "Awaiting approval") {
    const request = await db.approvalRequest.findUnique({ where: { id: order.approvalRequestId } });
    if (request?.status === "Approved") status = "Approved";
    else if (request?.status === "Rejected") status = "Rejected";
  }

  // Then let what has actually arrived decide the rest.
  status = statusFromReceipts(status, order.lines);

  if (status !== order.status) {
    await db.purchaseOrder.update({
      where: { id: orderId },
      data: {
        status,
        ...(status === "Approved" && !order.approvedAt ? { approvedAt: new Date() } : {}),
      },
    });
  }
  return status;
}

export async function cancelOrder(orderId: string, by: string): Promise<Outcome> {
  const order = await db.purchaseOrder.findUnique({
    where: { id: orderId },
    include: { lines: { include: { receipts: { select: { quantity: true } } } } },
  });
  if (!order) return { ok: false, error: "Not found" };
  if (CLOSED.has(order.status)) {
    return { ok: false, error: `This order is already ${order.status.toLowerCase()}.` };
  }

  // Material already delivered cannot be un-delivered by cancelling the paper.
  const received = order.lines.some((l) => l.receipts.some((r) => r.quantity > 0));
  if (received) {
    return {
      ok: false,
      error: "Some of this order has already arrived. Receive or return the rest rather than cancelling what is already on the shelf.",
    };
  }

  await db.purchaseOrder.update({ where: { id: orderId }, data: { status: "Cancelled", notes: order.notes } });
  return { ok: true };
}

/* ============================================== receiving against an order */

export type ReceiveInput = {
  orderLineId: string;
  postedBy: string;
  storeId: string;
  date: string;
  quantity: number;
  reference: string;
  notes?: string | null;
  /**
   * Which bin it was put away into (INV-14).
   *
   * A store divided into bins refuses a movement that does not name one, and
   * the main store is both the store most likely to be binned and the store
   * orders are received into — so without this, receiving a purchase order
   * into the main store was refused outright.
   */
  binId?: string | null;
};

/**
 * Receive material against an order line.
 *
 * The approval gate is checked against the live status, not a remembered one,
 * and the stock side goes through the same seam every other receipt uses. The
 * price comes from the order rather than being typed again: what was agreed is
 * what the material is worth until the supplier's invoice says otherwise.
 */
export async function receiveAgainstOrder(input: ReceiveInput): Promise<Result<{ movementId: string }>> {
  const line = await db.purchaseOrderLine.findUnique({
    where: { id: input.orderLineId },
    include: { order: true, receipts: { select: { quantity: true } }, item: true },
  });
  if (!line) return { ok: false, error: "That order line was not found." };

  // The live status, so an approval granted a moment ago is honoured and one
  // that was revoked is not.
  const status = await syncOrderApproval(line.orderId);

  const permitted = checkReceipt(status, line.quantity, line.receipts, input.quantity, line.description);
  if (!permitted.ok) return permitted;

  if (!line.itemId) {
    return {
      ok: false,
      error: `${line.description} is not a catalogue item, so there is no shelf for it. Add it as an item first, or charge it to the job on the supplier invoice.`,
    };
  }

  // Weighed again while holding the order line's lock, against what has
  // arrived by then, and written with the line already attached. Checking the
  // figure read at the top and attaching the line afterwards let ten deliveries
  // of five, recorded at once, all pass against an order for ten.
  const moved = await recordMovement(
    {
      companyId: line.order.companyId,
      postedBy: input.postedBy,
      kind: "Receipt",
      itemId: line.itemId,
      storeId: input.storeId,
      date: input.date,
      quantity: input.quantity,
      unitCost: line.unitPrice,
      partyId: line.order.partyId,
      reference: input.reference,
      notes: input.notes ?? null,
      binId: input.binId ?? null,
      purchaseOrderLineId: line.id,
    },
    {
      lockKeys: [orderLineKey(line.id)],
      guard: async (client) => {
        const arrived = await client.stockMovement.findMany({
          where: { purchaseOrderLineId: line.id },
          select: { quantity: true },
        });
        return checkReceipt(status, line.quantity, arrived, input.quantity, line.description);
      },
    },
  );
  if (!moved.ok) return moved;

  // The order's status follows from what has now arrived.
  await syncOrderApproval(line.orderId);
  return { ok: true, movementId: moved.movementId };
}

/** Every order that can still be received against, newest first. */
export async function openOrders(companyId: string) {
  return db.purchaseOrder.findMany({
    where: { companyId, status: { in: [...RECEIVABLE] } },
    include: {
      lines: { include: { receipts: { select: { quantity: true } }, item: true }, orderBy: { sortOrder: "asc" } },
    },
    orderBy: { date: "desc" },
  });
}
