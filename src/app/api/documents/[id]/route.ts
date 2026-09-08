import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { downloadHeaders, ALLOWED_TYPES } from "@/lib/uploads";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  if (!session) return new NextResponse("Unauthorized", { status: 401 });
  if (!can(session, "hr.employees")) return new NextResponse("Forbidden", { status: 403 });

  const doc = await db.employeeDocument.findUnique({ where: { id } });
  if (!doc || !session.companies.some((c) => c.id === doc.companyId)) {
    return new NextResponse("Not found", { status: 404 });
  }

  // A path built from a stored name that is sixteen random bytes plus a known
  // extension cannot escape the directory — but it is asserted rather than
  // assumed, because the day someone changes how storedName is produced this is
  // the line that should stop them.
  const uploads = path.join(process.cwd(), "uploads");
  const file = path.join(uploads, path.basename(doc.storedName));
  if (!file.startsWith(uploads + path.sep)) return new NextResponse("Not found", { status: 404 });

  // Serve only a type on the allow-list. A row written before the list existed
  // may carry anything the browser once claimed, so it is checked here too and
  // sent as a plain download if it is not recognised.
  const known = ALLOWED_TYPES.some((t) => t.mime === doc.mimeType);
  const mime = known ? doc.mimeType : "application/octet-stream";

  try {
    const buf = await fs.readFile(file);
    return new NextResponse(new Uint8Array(buf), { headers: downloadHeaders(mime, doc.fileName) });
  } catch {
    return new NextResponse("File missing", { status: 404 });
  }
}
