import { ShieldCheck, CheckCircle2, AlertTriangle } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import ChangePasswordForm from "@/components/ChangePasswordForm";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function AccountPage({ searchParams }: { searchParams: Promise<{ changed?: string; forceChange?: string }> }) {
  const session = await getSession();
  if (!session) return null;
  const sp = await searchParams;
  const user = await db.user.findUnique({ where: { id: session.user.id } });
  const roleNames = Array.from(new Set(session.companies.map((c) => c.role)));

  return (
    <div>
      <PageHeader title="My Account" subtitle="Your profile and sign-in security." />

      {sp.changed && (
        <div className="mb-5 flex items-center gap-2 rounded-lg bg-brand-green/10 px-4 py-3 text-sm text-brand-green-700">
          <CheckCircle2 className="h-4 w-4" /> Your password has been updated.
        </div>
      )}
      {(sp.forceChange || user?.mustReset) && !sp.changed && (
        <div className="mb-5 flex items-center gap-2 rounded-lg bg-brand-gold/15 px-4 py-3 text-sm text-brand-gold">
          <AlertTriangle className="h-4 w-4" /> Your password was reset by an administrator — please set a new password to continue.
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* Profile */}
        <div className="card p-5">
          <h2 className="mb-4 font-semibold text-heading">Profile</h2>
          <dl className="space-y-3 text-sm">
            <div className="flex justify-between"><dt className="text-muted">Name</dt><dd className="font-medium text-ink">{session.user.name}</dd></div>
            <div className="flex justify-between"><dt className="text-muted">Email</dt><dd className="text-ink">{session.user.email}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-muted">Role(s)</dt><dd className="text-right text-ink">{roleNames.join(", ") || "—"}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-muted">Companies</dt><dd className="text-right text-ink">{session.companies.map((c) => c.code).join(", ") || "—"}</dd></div>
            <div className="flex justify-between"><dt className="text-muted">Password last changed</dt><dd className="text-ink">{user?.passwordChangedAt ? new Date(user.passwordChangedAt).toLocaleDateString("en-GB") : "—"}</dd></div>
          </dl>
        </div>

        {/* Change password */}
        <div className="card p-5">
          <div className="mb-4 flex items-center gap-2 text-heading">
            <ShieldCheck className="h-5 w-5" /><h2 className="font-semibold">Change password</h2>
          </div>
          <ChangePasswordForm />
        </div>
      </div>
    </div>
  );
}
