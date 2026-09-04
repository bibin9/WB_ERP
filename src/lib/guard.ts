import "server-only";
import { redirect } from "next/navigation";
import { getSession } from "./auth";
import { can, type Action } from "./rbac";

/** Redirect to dashboard if the current user lacks access to a screen/module. */
export async function requireAccess(moduleKey: string, action: Action = "view") {
  const session = await getSession();
  if (!can(session, moduleKey, action)) redirect("/dashboard");
  return session!;
}

/**
 * Permission check for server actions and API routes, which must not redirect.
 * Returns the session when allowed, otherwise null — callers bail out quietly.
 */
export async function allow(screenKey: string, action: Action = "view") {
  const session = await getSession();
  if (!can(session, screenKey, action)) return null;
  return session!;
}

/** As `allow`, but also confirms the company is inside the user's scope. */
export async function allowIn(companyId: string, screenKey: string, action: Action = "view") {
  const session = await allow(screenKey, action);
  if (!session || !session.companies.some((c) => c.id === companyId)) return null;
  return session;
}
