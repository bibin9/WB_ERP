import Link from "next/link";
import clsx from "clsx";
import { AlertTriangle, Send, ShieldCheck, Info } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import CompanyPicker from "@/components/CompanyPicker";
import FinanceTabs from "@/components/FinanceTabs";
import TransmitInvoice from "@/components/finance/TransmitInvoice";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { requireAccess } from "@/lib/guard";
import { can } from "@/lib/rbac";
import { settingsFor, providerFor } from "@/lib/einvoice-asp";

export const dynamic = "force-dynamic";

const n = (v: number) => v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt = (d?: Date | null) =>
  d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—";

/** Where a document has got to, and whether that is somewhere it should stay. */
const STATUS_STYLE: Record<string, string> = {
  "Not applicable": "bg-line text-muted",
  Ready: "bg-brand-blue/10 text-brand-blue-600",
  Queued: "bg-brand-gold/15 text-brand-gold",
  Sent: "bg-brand-blue/10 text-brand-blue-600",
  Accepted: "bg-brand-green/10 text-brand-green-700",
  Delivered: "bg-brand-green/10 text-brand-green-700",
  Rejected: "bg-red-50 text-red-600",
  Failed: "bg-red-50 text-red-600",
};

export default async function EInvoicingPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string }>;
}) {
  await requireAccess("finance.einvoicing");
  const session = await getSession();
  const sp = await searchParams;
  const accessible = session?.companies ?? [];
  const companyId = accessible.find((c) => c.id === sp.c)?.id ?? accessible[0]?.id ?? "";
  const maySend = can(session, "finance.einvoicing", "approve");

  const settings = companyId
    ? await settingsFor(companyId)
    : { customizationId: "", profileId: "", provider: null };
  const provider = providerFor(settings.provider);
  const configured = !!settings.customizationId && !!settings.profileId && !!settings.provider;

  const rows = companyId
    ? await db.invoice.findMany({
        where: { companyId, side: "Sales", status: "Issued" },
        orderBy: { issueDate: "desc" },
        take: 200,
        select: {
          id: true, number: true, docType: true, issueDate: true, partyName: true,
          grossTotal: true, eInvoiceStatus: true, eInvoiceRef: true, eInvoiceError: true,
          eInvoiceSentAt: true, eInvoiceAttempts: true,
        },
      })
    : [];

  const waiting = rows.filter((r) => ["Not applicable", "Ready", "Queued", "Failed", "Rejected"].includes(r.eInvoiceStatus));
  const problems = rows.filter((r) => ["Failed", "Rejected"].includes(r.eInvoiceStatus));

  return (
    <div>
      <PageHeader
        title="Finance — Electronic invoicing"
        subtitle="What has reached the FTA through your service provider, and what has not."
      />

      <FinanceTabs companyId={companyId} />

      <div className="mb-5">
        <CompanyPicker companies={accessible.map((c) => ({ id: c.id, code: c.code, name: c.name }))} current={companyId} />
      </div>

      {!configured ? (
        <div className="mb-5 flex items-start gap-3 rounded-lg border border-brand-gold/40 bg-brand-gold/10 px-4 py-3 text-sm text-ink">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-brand-gold" />
          <div>
            <p className="font-medium">Electronic invoicing is not switched on for this company.</p>
            <p className="mt-1">
              UAE eInvoicing runs through an Accredited Service Provider: this system hands them the
              document, and they validate, sign and transmit it to the FTA. Nothing here talks to the
              FTA directly, and nothing is transmitted until a provider is named on{" "}
              <Link href={`/finance/settings?c=${companyId}`} className="text-brand-blue-600 hover:underline">
                Finance → Setup → Finance Settings
              </Link>
              . Your invoices are unaffected in the meantime.
            </p>
          </div>
        </div>
      ) : (
        <div className="mb-5 flex items-start gap-3 rounded-lg border border-brand-green/40 bg-brand-green/10 px-4 py-3 text-sm text-brand-green-700">
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0" />
          <p>
            Transmitting through <span className="font-medium">{provider.name}</span>.
            {problems.length > 0 ? " Some documents have not got through — see below." : ""}
          </p>
        </div>
      )}

      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Tile label="Issued invoices" value={String(rows.length)} sub="in the last 200" />
        <Tile label="Reached the FTA" value={String(rows.filter((r) => ["Accepted", "Delivered"].includes(r.eInvoiceStatus)).length)} />
        <Tile label="Not sent yet" value={String(waiting.length - problems.length)} accent={waiting.length - problems.length > 0 ? "gold" : undefined} />
        <Tile label="Refused or failed" value={String(problems.length)} accent={problems.length > 0 ? "red" : undefined} />
      </div>

      <div className="card overflow-hidden">
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="font-semibold text-heading">Every issued document</h2>
          <span className="text-xs text-muted">newest first</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-brand-paper text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-4 py-2.5 font-semibold">Document</th>
                <th className="px-4 py-2.5 font-semibold">Date</th>
                <th className="px-4 py-2.5 font-semibold">Customer</th>
                <th className="px-4 py-2.5 text-right font-semibold">Total</th>
                <th className="px-4 py-2.5 font-semibold">Status</th>
                <th className="px-4 py-2.5 font-semibold">Provider reference</th>
                <th className="px-4 py-2.5 font-semibold print:hidden" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-muted">
                  No issued invoices yet. A draft is never transmitted.
                </td></tr>
              )}
              {rows.map((r) => (
                <tr key={r.id} className={clsx("align-top", ["Failed", "Rejected"].includes(r.eInvoiceStatus) && "bg-red-50/60")}>
                  <td className="whitespace-nowrap px-4 py-2.5">
                    <Link href={`/finance/invoices/${r.id}`} className="font-medium text-brand-blue-600 hover:underline">
                      {r.number}
                    </Link>
                    {r.docType !== "Invoice" && <div className="text-[11px] text-muted">{r.docType}</div>}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-xs text-muted">{fmt(r.issueDate)}</td>
                  <td className="px-4 py-2.5 text-ink">{r.partyName}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-heading">{n(r.grossTotal)}</td>
                  <td className="px-4 py-2.5">
                    <span className={clsx("rounded-full px-2 py-0.5 text-xs font-medium", STATUS_STYLE[r.eInvoiceStatus] ?? "bg-line text-muted")}>
                      {r.eInvoiceStatus === "Not applicable" ? "Not sent" : r.eInvoiceStatus}
                    </span>
                    {r.eInvoiceError && (
                      <div className="mt-1 max-w-md text-[11px] text-red-600">{r.eInvoiceError}</div>
                    )}
                    {r.eInvoiceAttempts > 1 && (
                      <div className="text-[11px] text-muted">{r.eInvoiceAttempts} attempts</div>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 font-mono text-xs text-muted">
                    {r.eInvoiceRef ?? "—"}
                    {r.eInvoiceSentAt && <div className="font-sans text-[11px]">{fmt(r.eInvoiceSentAt)}</div>}
                  </td>
                  <td className="px-4 py-2.5 print:hidden">
                    <TransmitInvoice
                      id={r.id}
                      number={r.number}
                      status={r.eInvoiceStatus}
                      maySend={maySend}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card mt-5 flex items-start gap-3 p-5">
        <Info className="mt-0.5 h-5 w-5 shrink-0 text-brand-blue-600" />
        <div className="text-sm text-muted">
          <p>
            <span className="font-medium text-ink">Five corners:</span> you, your service provider,
            the customer&rsquo;s provider, the customer, and the FTA. A document can be accepted by
            your provider and refused by the customer&rsquo;s hours later, which is why{" "}
            <span className="text-ink">Sent</span>, <span className="text-ink">Accepted</span> and{" "}
            <span className="text-ink">Delivered</span> are separate here rather than one tick.
          </p>
          <p className="mt-2">
            <span className="font-medium text-ink">Preview before you send.</span> It shows the exact
            document that would leave, and lists anything a validator would refuse — a rejection from
            somebody else&rsquo;s system arrives long after the customer has the invoice.
          </p>
        </div>
      </div>
    </div>
  );
}

function Tile({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: "gold" | "red" }) {
  return (
    <div className="card p-5">
      <div className="text-sm text-muted">{label}</div>
      <div className={clsx(
        "mt-1 text-2xl font-bold tabular-nums",
        accent === "red" ? "text-red-600" : accent === "gold" ? "text-brand-gold" : "text-heading",
      )}>{value}</div>
      {sub ? <div className="mt-0.5 text-xs text-muted">{sub}</div> : null}
    </div>
  );
}
