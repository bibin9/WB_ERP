import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/session-token";

/**
 * Where a browser is sent when its cookie is still signed but its session has
 * ended — signed out elsewhere, password changed, account deactivated or
 * removed. Middleware only checks the signature, so without this the person
 * landed on an empty shell with no name and no menu. The dead cookie is
 * cleared here and they are taken to the sign-in page.
 */
export function GET(req: NextRequest) {
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  const res = NextResponse.redirect(url);
  res.cookies.delete(SESSION_COOKIE);
  return res;
}
