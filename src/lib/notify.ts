import "server-only";
import { db } from "./db";

type Payload = { type?: string; title: string; body?: string | null; link?: string | null };

/** Create in-app notifications for a set of users. */
export async function notify(tenantId: string, userIds: string[], payload: Payload) {
  const ids = [...new Set(userIds)];
  if (ids.length === 0) return;
  await db.notification.createMany({
    data: ids.map((userId) => ({
      tenantId,
      userId,
      type: payload.type ?? "info",
      title: payload.title,
      body: payload.body ?? null,
      link: payload.link ?? null,
    })),
  });
}

/** Notify everyone who can act on an approval step (role level >= required). */
export async function notifyApprovers(
  tenantId: string,
  companyId: string,
  requiredLevel: number,
  payload: Payload
) {
  const members = await db.companyMembership.findMany({
    where: { companyId, role: { approvalLevel: { gte: requiredLevel } } },
    select: { userId: true },
  });
  await notify(tenantId, members.map((m) => m.userId), { type: "approval", ...payload });
}
