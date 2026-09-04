import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/rbac";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  if (!session) return new NextResponse("Unauthorized", { status: 401 });
  if (!can(session, "hr.employees")) return new NextResponse("Forbidden", { status: 403 });

  const doc = await db.employeeDocument.findUnique({ where: { id } });
  if (!doc || !session.companies.some((c) => c.id === doc.companyId)) {
    return new NextResponse("Not found", { status: 404 });
  }

  try {
    const buf = await fs.readFile(path.join(process.cwd(), "uploads", doc.storedName));
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type": doc.mimeType,
        "Content-Disposition": `inline; filename="${doc.fileName.replace(/"/g, "")}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch {
    return new NextResponse("File missing", { status: 404 });
  }
}
