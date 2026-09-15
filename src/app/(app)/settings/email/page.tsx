import { Mail } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import CompanyPicker from "@/components/CompanyPicker";
import MailSettingsForm from "@/components/settings/MailSettingsForm";
import { requireAccess } from "@/lib/guard";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { mailSettingsFor } from "@/lib/mailer";
import { mailVerdict } from "@/lib/mailsettings";

export const dynamic = "force-dynamic";

const stamp = (d: Date | null) =>
  d ? new Date(d).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";

/**
 * Where this company's email goes out from (CRM-15).
 *
 * Per company, because a group sends as one of its trading names depending on
 * whose work it is, and the customer should see the right one.
 */
export default async function EmailSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string }>;
}) {
  await requireAccess("settings.email");
  const session = await getSession();
  const sp = await searchParams;
  const accessible = session?.companies ?? [];
  const companyId = accessible.find((c) => c.id === sp.c)?.id ?? accessible[0]?.id ?? "";

  const settings = companyId ? await mailSettingsFor(companyId) : null;

  const recent = companyId
    ? await db.emailLog.findMany({
        where: { companyId },
        orderBy: { sentAt: "desc" },
        take: 15,
      })
    : [];

  return (
    <div>
      <PageHeader
        title="Email"
        subtitle={mailVerdict(settings ?? {})}
      />

      <div className="mb-5">
        <CompanyPicker
          companies={accessible.map((c) => ({ id: c.id, code: c.code, name: c.name }))}
          current={companyId}
        />
      </div>

      {companyId && (
        <MailSettingsForm
          companyId={companyId}
          existing={
            settings
              ? {
                  host: settings.host,
                  port: settings.port,
                  security: settings.security,
                  username: settings.username,
                  hasPassword: settings.hasPassword,
                  fromName: settings.fromName,
                  fromEmail: settings.fromEmail,
                  replyTo: settings.replyTo,
                  isActive: settings.isActive,
                }
              : null
          }
          defaultTestTo={session?.user.email ?? ""}
        />
      )}

      {recent.length > 0 && (
        <div className="mt-6">
          <h2 className="mb-2 text-sm font-medium uppercase tracking-wide text-muted">What has been sent</h2>
          <div className="card overflow-x-auto">
            <table className="w-full min-w-[44rem] text-sm">
              <thead className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-4 py-2.5 font-medium">When</th>
                  <th className="px-4 py-2.5 font-medium">To</th>
                  <th className="px-4 py-2.5 font-medium">Subject</th>
                  <th className="px-4 py-2.5 font-medium">By</th>
                  <th className="px-4 py-2.5 font-medium">Result</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {recent.map((l) => (
                  <tr key={l.id}>
                    <td className="whitespace-nowrap px-4 py-2.5 text-xs text-muted">{stamp(l.sentAt)}</td>
                    <td className="px-4 py-2.5 text-xs text-ink">{l.toAddresses}</td>
                    <td className="px-4 py-2.5 text-xs text-ink">{l.subject}</td>
                    <td className="px-4 py-2.5 text-xs text-muted">{l.sentBy ?? "—"}</td>
                    <td className="px-4 py-2.5 text-xs">
                      {l.ok ? (
                        <span className="rounded bg-brand-green/10 px-1.5 py-0.5 text-brand-green-700">
                          Accepted
                        </span>
                      ) : (
                        <>
                          <span className="rounded bg-brand-gold/10 px-1.5 py-0.5 text-brand-gold">Failed</span>
                          <div className="mt-0.5 max-w-md text-muted">{l.error}</div>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="mt-6 flex items-start gap-2 text-xs text-muted">
        <Mail className="mt-0.5 h-4 w-4 shrink-0" />
        <p className="max-w-3xl">
          Nothing about your mail server is written into the application &mdash; the server name, the port, the
          security and the mailbox it signs in as are all set here, and changing provider is a change on this
          screen rather than a change to the software. The password is encrypted before it is stored and is never
          shown back, not even to an administrator: it is a way into the mailbox where every contract, invoice and
          price the company has ever sent lives. The result column says <span className="font-medium">Accepted</span>{" "}
          rather than delivered, because that is the strongest honest claim &mdash; whether the customer received
          it, read it, or found it in junk is beyond anything a sending system can know.
        </p>
      </div>
    </div>
  );
}
