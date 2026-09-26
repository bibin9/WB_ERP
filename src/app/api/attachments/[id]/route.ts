import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { downloadHeaders, ALLOWED_TYPES } from "@/lib/uploads";
import { attachableFor } from "@/lib/attachments";

/**
 * Handing back a file filed against a bill or an order.
 *
 * Guarded twice over: the screen the file belongs to (a storekeeper may not
 * read the supplier's bill because a PDF of it was attached to one), and the
 * company it was filed in. Checked here rather than only at upload, because a
 * link is forwarded and a role changes.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  if (!session) return new NextResponse("Unauthorized", { status: 401 });

  const row = await db.attachment.findUnique({ where: { id } });
  if (!row || !session.companies.some((c) => c.id === row.companyId)) {
    return new NextResponse("Not found", { status: 404 });
  }

  const a = attachableFor(row.entity);
  if (!a || !can(session, a.screen)) return new NextResponse("Forbidden", { status: 403 });

  // A path built from sixteen random bytes plus a known extension cannot
  // escape the directory — asserted rather than assumed, because the day
  // somebody changes how storedName is produced this is the line to stop them.
  const uploads = path.join(process.cwd(), "uploads");
  const file = path.join(uploads, path.basename(row.storedName));
  if (!file.startsWith(uploads + path.sep)) return new NextResponse("Not found", { status: 404 });

  const known = ALLOWED_TYPES.some((t) => t.mime === row.mimeType);
  const mime = known ? row.mimeType : "application/octet-stream";

  try {
    const buf = await fs.readFile(file);
    return new NextResponse(new Uint8Array(buf), { headers: downloadHeaders(mime, row.fileName) });
  } catch {
    return new NextResponse("File missing", { status: 404 });
  }
}
