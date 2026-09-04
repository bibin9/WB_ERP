import { ShieldCheck } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import UserForm from "@/components/UserForm";
import ActiveToggle from "@/components/ActiveToggle";
import GuardedDelete from "@/components/GuardedDelete";
import UserSecurityControls from "@/components/UserSecurityControls";
import { setUserActive, deleteUser } from "@/app/(app)/users/actions";
import { db } from "@/lib/db";
import { requireAccess } from "@/lib/guard";
import { getSession } from "@/lib/auth";
import { activeTenant } from "@/config/tenant";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
  await requireAccess("users.list");
  const session = await getSession();
  const now = new Date();
  const tenant = await db.tenant.findUnique({ where: { key: activeTenant.key } });
  const users = tenant
    ? await db.user.findMany({
        where: { tenantId: tenant.id },
        include: { memberships: { include: { company: true, role: true } } },
        orderBy: { name: "asc" },
      })
    : [];
  const roles = tenant
    ? await db.role.findMany({ where: { tenantId: tenant.id }, orderBy: { approvalLevel: "desc" } })
    : [];
  const companies = tenant
    ? await db.company.findMany({ where: { tenantId: tenant.id }, orderBy: { code: "asc" } })
    : [];

  return (
    <div>
      <PageHeader
        title="Users & Roles"
        subtitle="Role-based access control. Each user is granted a role per company they can access."
      >
        <UserForm
          companies={companies.map((c) => ({ id: c.id, label: `${c.code} — ${c.name}` }))}
          roles={roles.map((r) => ({ id: r.id, label: r.name }))}
        />
      </PageHeader>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Users */}
        <div className="card lg:col-span-2">
          <div className="border-b border-line px-5 py-3">
            <h2 className="font-semibold text-heading">Users</h2>
          </div>
          <div className="divide-y divide-line">
            {users.map((u) => (
              <div key={u.id} className="flex items-start gap-3 px-5 py-3.5">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-blue text-xs font-semibold text-white">
                  {u.name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-ink">{u.name}</span>
                    {u.lockedUntil && u.lockedUntil > now && (
                      <span className="rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-semibold text-red-600">Locked</span>
                    )}
                    {u.mustReset && (
                      <span className="rounded-full bg-brand-gold/15 px-2 py-0.5 text-[10px] font-semibold text-brand-gold">Reset pending</span>
                    )}
                  </div>
                  <div className="text-xs text-muted">{u.email}</div>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {u.memberships.map((m) => (
                      <span key={m.id} className="rounded bg-brand-navy/5 px-2 py-0.5 text-xs text-heading">
                        {m.company.code} · {m.role.name}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <UserSecurityControls userId={u.id} locked={!!(u.lockedUntil && u.lockedUntil > now)} isSelf={u.id === session?.user.id} />
                  <ActiveToggle isActive={u.isActive} action={setUserActive.bind(null, u.id)} />
                  <UserForm
                    companies={companies.map((c) => ({ id: c.id, label: `${c.code} — ${c.name}` }))}
                    roles={roles.map((r) => ({ id: r.id, label: r.name }))}
                    user={{ id: u.id, name: u.name, roleId: u.memberships[0]?.role.id }}
                  />
                  <GuardedDelete screen="users.list" action={deleteUser.bind(null, u.id)} label={`Delete user ${u.name}?`} />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Roles */}
        <div className="card">
          <div className="flex items-center gap-2 border-b border-line px-5 py-3 text-heading">
            <ShieldCheck className="h-4 w-4" />
            <h2 className="font-semibold">Roles &amp; sign-off level</h2>
          </div>
          <div className="divide-y divide-line">
            {roles.map((r) => (
              <div key={r.id} className="flex items-center justify-between px-5 py-2.5">
                <span className="text-sm text-ink">{r.name}</span>
                <span className="rounded bg-brand-gold/15 px-2 py-0.5 text-xs font-semibold text-brand-gold">
                  L{r.approvalLevel}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
