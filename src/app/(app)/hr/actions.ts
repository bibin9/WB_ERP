"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";

function rev() {
  revalidatePath("/hr/tasks");
  revalidatePath("/dashboard");
}

async function nextTicketNo(companyId: string): Promise<string> {
  const company = await db.company.findUnique({ where: { id: companyId } });
  const n = await db.jobAssignment.count({ where: { companyId } });
  const code = company?.code ?? "JOB";
  return `JOB/${code}/${String(n + 1).padStart(4, "0")}`;
}

export async function createJob(formData: FormData) {
  const session = await getSession();
  if (!session) return;
  const companyId = String(formData.get("companyId") || "");
  const title = String(formData.get("title") || "").trim();
  if (!companyId || !title || !session.companies.some((c) => c.id === companyId)) return;

  const dueRaw = String(formData.get("dueDate") || "");
  const ticketNo = await nextTicketNo(companyId);
  const created = await db.jobAssignment.create({
    data: {
      companyId,
      ticketNo,
      title,
      description: String(formData.get("description") || "") || null,
      priority: String(formData.get("priority") || "Normal"),
      assignedToType: String(formData.get("assignedToType") || "person"),
      assignedTo: String(formData.get("assignedTo") || "").trim() || "Unassigned",
      assignedBy: session.user.name,
      timeAllocation: String(formData.get("timeAllocation") || "") || null,
      dueDate: dueRaw ? new Date(dueRaw) : null,
      status: "Open",
    },
  });
  await audit({ action: "Created", entity: "JobAssignment", entityId: created.id, summary: `Created task ${ticketNo} — ${title}` });
  rev();
}

export async function updateJob(formData: FormData) {
  const session = await getSession();
  if (!session) return;
  const id = String(formData.get("id") || "");
  const job = await db.jobAssignment.findUnique({ where: { id } });
  if (!job || !session.companies.some((c) => c.id === job.companyId)) return;
  const title = String(formData.get("title") || "").trim();
  if (!title) return;
  const dueRaw = String(formData.get("dueDate") || "");
  await db.jobAssignment.update({
    where: { id },
    data: {
      title,
      description: String(formData.get("description") || "") || null,
      priority: String(formData.get("priority") || "Normal"),
      assignedToType: String(formData.get("assignedToType") || "person"),
      assignedTo: String(formData.get("assignedTo") || "").trim() || "Unassigned",
      timeAllocation: String(formData.get("timeAllocation") || "") || null,
      dueDate: dueRaw ? new Date(dueRaw) : null,
    },
  });
  await audit({ action: "Updated", entity: "JobAssignment", entityId: id, summary: `Updated task ${job.ticketNo} — ${title}` });
  rev();
}

export async function updateStatus(id: string, status: string) {
  const session = await getSession();
  if (!session) return;
  const job = await db.jobAssignment.findUnique({ where: { id } });
  if (!job || !session.companies.some((c) => c.id === job.companyId)) return;
  const data: Record<string, unknown> = { status };
  if (status === "Closed") {
    data.closedBy = session.user.name;
    data.closedAt = new Date();
  }
  await db.jobAssignment.update({ where: { id }, data });
  await audit({ action: "Updated", entity: "JobAssignment", entityId: id, summary: `${job.ticketNo} → ${status}` });
  rev();
}

export async function deleteJob(id: string) {
  const session = await getSession();
  if (!session) return;
  const job = await db.jobAssignment.findUnique({ where: { id } });
  if (!job || !session.companies.some((c) => c.id === job.companyId)) return;
  await db.jobAssignment.delete({ where: { id } });
  await audit({ action: "Deleted", entity: "JobAssignment", entityId: id, summary: `Deleted task ${job.ticketNo}` });
  rev();
}
