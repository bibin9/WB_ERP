import { getSession } from "@/lib/auth";
import { can } from "@/lib/rbac";
import ConfirmDelete from "./ConfirmDelete";

/**
 * Delete control that renders nothing unless the signed-in user actually holds
 * "delete" on the given screen. Keeps the UI honest with the server-side guard
 * in the action, so view-only roles never see a button that would be refused.
 */
export default async function GuardedDelete({
  screen,
  action,
  label,
  compact,
}: {
  screen: string;
  action: () => Promise<{ ok?: boolean; error?: string } | void>;
  label?: string;
  compact?: boolean;
}) {
  const session = await getSession();
  if (!can(session, screen, "delete")) return null;
  return <ConfirmDelete action={action} label={label} compact={compact} />;
}
