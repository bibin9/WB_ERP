"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";

export async function markRead(id: string) {
  const session = await getSession();
  if (!session) return;
  await db.notification.updateMany({ where: { id, userId: session.user.id }, data: { isRead: true } });
  revalidatePath("/notifications");
}

export async function markAllRead() {
  const session = await getSession();
  if (!session) return;
  await db.notification.updateMany({ where: { userId: session.user.id, isRead: false }, data: { isRead: true } });
  revalidatePath("/notifications");
}
