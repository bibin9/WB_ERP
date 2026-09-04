import Link from "next/link";
import { ArrowLeft, ShieldCheck, Crown } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import GuardedDelete from "@/components/GuardedDelete";
import CreateRoleForm from "@/components/roles/CreateRoleForm";
import PermissionMatrix from "@/components/roles/PermissionMatrix";
import { deleteRole } from "./actions";
import { parsePerms } from "@/lib/rbac";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { requireAccess } from "@/lib/guard";

export const dynamic = "force-dynamic";

export default async function RolesPage() {
  await requireAccess("users.access");
  const session = await getSession();
  if (!session) return null;
  const roles = await db.role.findMany({
    where: { tenantId: session.tenant.id },
    include: { _count: { select: { memberships: true } } },
    orderBy: { approvalLevel: "desc" },
  });

  return (
    <div>
      <PageHeader title="Roles & Access Control" subtitle="Open a module and grant access screen-by-screen — choose exactly which screens each role can view, create, edit, delete and approve." />
      <Link href="/settings" className="mb-4 inline-flex items-center gap-1 text-sm text-brand-blue-600 hover:underline"><ArrowLeft className="h-4 w-4" /> Back to Settings</Link>

      <div className="mb-5 card p-4"><CreateRoleForm /></div>

      <div className="space-y-4">
        {roles.map((r) => {
          const admin = r.approvalLevel >= 80 || r.name === "Group Admin";
          return (
            <div key={r.id} className="card p-5">
              <div className="mb-3 flex flex-wrap items-center gap-3">
                <ShieldCheck className="h-4 w-4 text-brand-blue-600" />
                <h2 className="font-semibold text-brand-navy">{r.name}</h2>
                <span className="rounded-full bg-brand-gold/15 px-2 py-0.5 text-xs font-semibold text-brand-gold">L{r.approvalLevel}</span>
                <span className="text-xs text-muted">{r._count.memberships} user(s)</span>
                {r._count.memberships === 0 && (
                  <span className="ml-auto"><GuardedDelete screen="users.access" action={deleteRole.bind(null, r.id)} label={`Delete role ${r.name}?`} /></span>
                )}
              </div>
              {admin ? (
                <div className="flex items-center gap-2 rounded-lg bg-brand-navy/5 px-4 py-3 text-sm text-brand-navy">
                  <Crown className="h-4 w-4 text-brand-gold" /> Full access to all screens (administrator role — level ≥ 80).
                </div>
              ) : (
                <PermissionMatrix roleId={r.id} perms={parsePerms(r.permissions)} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
