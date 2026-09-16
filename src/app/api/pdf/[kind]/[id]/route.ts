import { NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { DOCUMENTS } from "@/documents/registry";

export const dynamic = "force-dynamic";

/**
 * A document as a PDF: /api/pdf/quotation/<id>
 *
 * Opens in the browser by default, which is also how it is printed — the
 * browser's own PDF viewer prints the file exactly as drawn. Add ?download=1 to
 * save it instead.
 *
 * Guarded by the permission of the screen the document belongs to, and by
 * company: a document from a company the user cannot see is "not found",
 * never "forbidden", so its existence is not confirmed either.
 */
export async function GET(req: Request, { params }: { params: Promise<{ kind: string; id: string }> }) {
  const { kind, id } = await params;
  const doc = DOCUMENTS[kind];
  if (!doc) return new NextResponse("Not found", { status: 404 });

  const session = await getSession();
  if (!session) return new NextResponse("Unauthorized", { status: 401 });
  if (!can(session, doc.screen)) return new NextResponse("Forbidden", { status: 403 });

  const data = await doc.load(id, session.companies.map((c) => c.id));
  if (!data) return new NextResponse("Not found", { status: 404 });

  const pdf = await renderToBuffer(doc.render(data as never));
  const download = new URL(req.url).searchParams.get("download") === "1";

  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${data.filename}"`,
      // Commercial documents: never cached by a proxy or left in a shared cache.
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
