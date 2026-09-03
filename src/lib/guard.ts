import "server-only";
import { redirect } from "next/navigation";
import { getSession } from "./auth";
import { can, type Action } from "./rbac";

/** Redirect to dashboard if the current user lacks access to a module. */
export async function requireAccess(moduleKey: string, action: Action = "view") {
  const session = await getSession();
  if (!can(session, moduleKey, action)) redirect("/dashboard");
  return session!;
}
