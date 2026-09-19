import { NextResponse, type NextRequest } from "next/server";
import { verifyToken, SESSION_COOKIE } from "@/lib/session-token";
import { contentSecurityPolicy, makeNonce } from "@/lib/csp";

// Protect the app; allow the login page and Next internals/assets through.
const PUBLIC = ["/login"];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const isPublic = PUBLIC.some((p) => pathname === p || pathname.startsWith(p + "/"));

  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const valid = token ? await verifyToken(token) : null;

  if (!valid && !isPublic) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }
  if (valid && pathname === "/login") {
    const url = req.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }
  // A fresh nonce per page. Next reads it from the request's policy and puts
  // it on every script it renders; the response carries the same policy.
  const nonce = makeNonce();
  const csp = contentSecurityPolicy(nonce, process.env.NODE_ENV === "production");
  const forward = new Headers(req.headers);
  forward.set("x-nonce", nonce);
  forward.set("Content-Security-Policy", csp);
  const res = NextResponse.next({ request: { headers: forward } });
  res.headers.set("Content-Security-Policy", csp);
  return res;
}

export const config = {
  // Run on everything except static assets and API internals
  matcher: ["/((?!_next/static|_next/image|favicon.ico|brand).*)"],
};
