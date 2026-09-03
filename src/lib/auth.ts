import "server-only";
import { cookies } from "next/headers";
import { db } from "./db";
import { SESSION_COOKIE } from "./session-token";
import { mergePerms, parsePerms } from "./rbac";

export { signSession, verifyToken, SESSION_COOKIE } from "./session-token";
export type { SessionToken } from "./session-token";

/** Full session for server components / actions: user + accessible companies + role. */
export async function getSession() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const { verifyToken } = await import("./session-token");
  const t = await verifyToken(token);
  if (!t) return null;

  const user = await db.user.findUnique({
    where: { id: t.uid },
    include: {
      memberships: { include: { company: true, role: true } },
      tenant: true,
    },
  });
  if (!user || !user.isActive) return null;

  const isAdmin = user.memberships.some((m) => m.role.approvalLevel >= 80 || m.role.name === "Group Admin");
  const perms = mergePerms(user.memberships.map((m) => parsePerms(m.role.permissions)));

  return {
    user: { id: user.id, name: user.name, email: user.email, mustReset: user.mustReset },
    tenant: { id: user.tenantId, name: user.tenant.name },
    companies: user.memberships.map((m) => ({
      id: m.company.id,
      code: m.company.code,
      name: m.company.name,
      role: m.role.name,
      approvalLevel: m.role.approvalLevel,
    })),
    isAdmin,
    perms,
  };
}

export async function setSessionCookie(token: string) {
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
}

export async function clearSessionCookie() {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

/** Highest approval/role level the current user holds across their companies. */
export async function currentMaxLevel(): Promise<number> {
  const s = await getSession();
  if (!s || s.companies.length === 0) return -1;
  return Math.max(...s.companies.map((c) => c.approvalLevel));
}

/** True if the current user is an admin-level user (can manage companies/users). */
export async function canAdminister(): Promise<boolean> {
  return (await currentMaxLevel()) >= 80; // Director / Group Admin and above
}
