import Link from "next/link";
import { AlertTriangle, Clock, IdCard } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import NotificationItem, { MarkAllButton } from "@/components/NotificationItem";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { markAllRead } from "./actions";

export const dynamic = "force-dynamic";

export default async function NotificationsPage() {
  const session = await getSession();
  if (!session) return null;
  const companyIds = session.companies.map((c) => c.id);

  const notifications = await db.notification.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  // Live "alerts" computed on the fly (no scheduler needed) — overdue / urgent tasks
  const now = new Date();
  const overdue = await db.jobAssignment.findMany({
    where: { companyId: { in: companyIds }, status: { notIn: ["Closed", "Completed"] }, dueDate: { lt: now } },
    include: { company: true },
    take: 10,
  });
  const urgent = await db.jobAssignment.findMany({
    where: { companyId: { in: companyIds }, status: { notIn: ["Closed", "Completed"] }, priority: "Urgent" },
    include: { company: true },
    take: 10,
  });
  const in30 = new Date(now.getTime() + 30 * 86400000);
  const expiringCerts = await db.certification.findMany({
    where: { companyId: { in: companyIds }, expiryDate: { not: null, lte: in30 } },
    include: { employee: true },
    orderBy: { expiryDate: "asc" },
    take: 12,
  });

  // UAE document expiry (Emirates ID / Visa / Labour Card) within 60 days — compliance intelligence
  const in60 = new Date(now.getTime() + 60 * 86400000);
  const docEmps = await db.employee.findMany({
    where: {
      companyId: { in: companyIds }, status: { not: "Inactive" },
      OR: [{ emiratesIdExpiry: { lte: in60 } }, { visaExpiry: { lte: in60 } }, { labourCardExpiry: { lte: in60 } }],
    },
    select: { name: true, emiratesIdExpiry: true, visaExpiry: true, labourCardExpiry: true },
  });
  const docAlerts: { name: string; label: string; date: Date }[] = [];
  for (const e of docEmps) {
    const add = (label: string, d: Date | null) => { if (d && d <= in60) docAlerts.push({ name: e.name, label, date: d }); };
    add("Emirates ID", e.emiratesIdExpiry);
    add("Visa", e.visaExpiry);
    add("Labour Card", e.labourCardExpiry);
  }
  docAlerts.sort((a, b) => a.date.getTime() - b.date.getTime());

  return (
    <div>
      <PageHeader title="Notifications & Alerts" subtitle="Approvals awaiting you, and live alerts across the group.">
        <MarkAllButton action={markAllRead} />
      </PageHeader>

      {/* UAE document expiry (visa / Emirates ID / labour card) */}
      {docAlerts.length > 0 && (
        <div className="card mb-5">
          <Link href="/hr/reports" className="flex items-center gap-2 border-b border-line px-5 py-3 text-red-600 hover:bg-brand-paper">
            <IdCard className="h-4 w-4" /> <h2 className="font-semibold">Documents expiring / expired</h2>
            <span className="ml-auto text-xs text-muted">{docAlerts.length} · view all →</span>
          </Link>
          <div className="divide-y divide-line">
            {docAlerts.slice(0, 12).map((d, i) => {
              const days = Math.ceil((d.date.getTime() - now.getTime()) / 86400000);
              return (
                <Link key={i} href="/hr/reports" className="flex items-center gap-2 px-5 py-2.5 text-sm hover:bg-brand-paper">
                  <span className="text-ink">{d.name}</span>
                  <span className="text-muted">· {d.label}</span>
                  <span className={days < 0 ? "ml-auto text-xs font-medium text-red-600" : "ml-auto text-xs font-medium text-brand-gold"}>
                    {days < 0 ? `Expired ${-days}d ago` : `Expires in ${days}d`}
                  </span>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {/* Certification expiry alerts (HR-13) */}
      {expiringCerts.length > 0 && (
        <div className="card mb-5">
          <Link href="/hr/reports" className="flex items-center gap-2 border-b border-line px-5 py-3 text-brand-gold hover:bg-brand-paper">
            <AlertTriangle className="h-4 w-4" /> <h2 className="font-semibold">Certifications expiring / expired</h2>
            <span className="ml-auto text-xs text-muted">{expiringCerts.length} · view all →</span>
          </Link>
          <div className="divide-y divide-line">
            {expiringCerts.map((c) => {
              const days = Math.ceil((new Date(c.expiryDate!).getTime() - now.getTime()) / 86400000);
              return (
                <Link key={c.id} href="/hr/certifications" className="flex items-center gap-2 px-5 py-2.5 text-sm hover:bg-brand-paper">
                  <span className="text-ink">{c.employee.name}</span>
                  <span className="text-muted">· {c.name} ({c.category})</span>
                  <span className={days < 0 ? "ml-auto text-xs font-medium text-red-600" : "ml-auto text-xs font-medium text-brand-gold"}>
                    {days < 0 ? `Expired ${-days}d ago` : `Expires in ${days}d`}
                  </span>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {/* Live alerts */}
      {(overdue.length > 0 || urgent.length > 0) && (
        <div className="mb-5 grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="card">
            <div className="flex items-center gap-2 border-b border-line px-5 py-3 text-red-600">
              <Clock className="h-4 w-4" /> <h2 className="font-semibold">Overdue tasks</h2>
              <span className="ml-auto text-xs text-muted">{overdue.length}</span>
            </div>
            <div className="divide-y divide-line">
              {overdue.length === 0 && <p className="px-5 py-4 text-sm text-muted">None 🎉</p>}
              {overdue.map((t) => (
                <Link key={t.id} href="/hr/tasks" className="block px-5 py-2.5 text-sm hover:bg-brand-paper">
                  <span className="text-ink">{t.title}</span>
                  <span className="ml-2 text-xs text-muted">{t.company.code} · was due {new Date(t.dueDate!).toLocaleDateString("en-GB")}</span>
                </Link>
              ))}
            </div>
          </div>
          <div className="card">
            <div className="flex items-center gap-2 border-b border-line px-5 py-3 text-brand-gold">
              <AlertTriangle className="h-4 w-4" /> <h2 className="font-semibold">Urgent tasks</h2>
              <span className="ml-auto text-xs text-muted">{urgent.length}</span>
            </div>
            <div className="divide-y divide-line">
              {urgent.length === 0 && <p className="px-5 py-4 text-sm text-muted">None</p>}
              {urgent.map((t) => (
                <Link key={t.id} href="/hr/tasks" className="block px-5 py-2.5 text-sm hover:bg-brand-paper">
                  <span className="text-ink">{t.title}</span>
                  <span className="ml-2 text-xs text-muted">{t.company.code} · {t.assignedTo}</span>
                </Link>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Inbox */}
      <div className="card">
        <div className="border-b border-line px-5 py-3">
          <h2 className="font-semibold text-heading">Inbox</h2>
        </div>
        <div className="divide-y divide-line">
          {notifications.length === 0 && <p className="px-5 py-10 text-center text-sm text-muted">No notifications yet.</p>}
          {notifications.map((n) => (
            <NotificationItem
              key={n.id}
              n={{ id: n.id, type: n.type, title: n.title, body: n.body, link: n.link, isRead: n.isRead, createdAt: n.createdAt.toISOString() }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
