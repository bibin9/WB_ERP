import clsx from "clsx";
import { AlertTriangle, TrendingDown, Wallet, Info } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import CompanyPicker from "@/components/CompanyPicker";
import FinanceTabs from "@/components/FinanceTabs";
import CashFlowControls from "@/components/CashFlowControls";
import { getSession } from "@/lib/auth";
import { requireAccess } from "@/lib/guard";
import { cashSourceFor } from "@/lib/cashflow-data";
import { buildForecast, verdict, DEFAULT_WEEKS, MIN_WEEKS, MAX_WEEKS, type CashEvent } from "@/lib/cashflow";

export const dynamic = "force-dynamic";

const n = (v: number) => v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const day = (d: Date) =>
  `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}`;

const KIND_LABEL: Record<CashEvent["kind"], string> = {
  "cheque-in": "Cheque in",
  "cheque-out": "Cheque out",
  receivable: "Invoice due",
  payable: "Bill due",
  "retention-in": "Retention released",
  "retention-out": "Retention to pay",
  payroll: "Payroll",
};

export default async function CashFlowPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string; weeks?: string; cautious?: string }>;
}) {
  await requireAccess("finance.cashflow");
  const session = await getSession();
  const sp = await searchParams;
  const accessible = session?.companies ?? [];
  const companyId = accessible.find((c) => c.id === sp.c)?.id ?? accessible[0]?.id ?? "";

  const weeksRaw = Number(sp.weeks);
  const weeks = Number.isFinite(weeksRaw) ? Math.min(MAX_WEEKS, Math.max(MIN_WEEKS, Math.floor(weeksRaw))) : DEFAULT_WEEKS;
  const cautious = sp.cautious === "1";

  const source = companyId
    ? await cashSourceFor(companyId, new Date(), weeks)
    : { opening: 0, cashAccounts: [], events: [], warnings: [], payroll: { amount: 0, dayOfMonth: 28, fromPeriod: null } };

  const f = buildForecast({ opening: source.opening, events: source.events, from: new Date(), weeks, cautious });
  const v = verdict(f);

  const tone = {
    good: "border-brand-green/40 bg-brand-green/10 text-brand-green-700",
    watch: "border-brand-gold/40 bg-brand-gold/10 text-ink",
    bad: "border-red-300 bg-red-50 text-red-700",
  }[v.tone];

  return (
    <div>
      <div className="print-header mb-4 hidden border-b border-line pb-3 print:block">
        <div className="text-lg font-bold text-heading">Cash Flow Forecast</div>
        <div className="text-xs text-muted">{weeks} weeks from today{cautious ? " · cautious view" : ""}</div>
      </div>

      <PageHeader
        title="Finance — Cash Flow Forecast"
        subtitle="What is in the bank now, what is due in and out, and whether it covers the next payroll."
      />

      <div className="mb-5">
        <CompanyPicker companies={accessible.map((c) => ({ id: c.id, code: c.code, name: c.name }))} current={companyId} />
      </div>

      <CashFlowControls weeks={weeks} cautious={cautious} />

      {source.warnings.map((w) => (
        <div key={w} className="mb-4 flex items-start gap-3 rounded-lg border border-brand-gold/40 bg-brand-gold/10 px-4 py-3 text-sm text-ink print:hidden">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-brand-gold" />
          <p>{w}</p>
        </div>
      ))}

      <div className={clsx("mb-5 flex items-start gap-3 rounded-lg border px-4 py-3 text-sm", tone)}>
        {v.tone === "good" ? <Wallet className="mt-0.5 h-5 w-5 shrink-0" /> : <TrendingDown className="mt-0.5 h-5 w-5 shrink-0" />}
        <p className="font-medium">{v.text}</p>
      </div>

      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Tile label="In the bank now" value={n(f.opening)} sub={source.cashAccounts.map((a) => `${a.code} ${a.name}`).join(", ") || "no account marked Cash"} />
        <Tile label="Expected in" value={n(f.totalIn)} accent="green" />
        <Tile label="Expected out" value={n(f.totalOut)} accent="red" />
        <Tile
          label="Lowest point"
          value={n(f.lowest.closing)}
          accent={f.lowest.closing < 0 ? "red" : undefined}
          sub={f.lowest.bucket ? f.lowest.bucket.label.toLowerCase() : "today"}
        />
      </div>

      <div className="card overflow-hidden">
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="font-semibold text-heading">Week by week</h2>
          <span className="text-xs text-muted">closing balance after each week</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-brand-paper text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-4 py-2.5 font-semibold">Week</th>
                <th className="px-4 py-2.5 font-semibold">Dates</th>
                <th className="px-4 py-2.5 text-right font-semibold">In</th>
                <th className="px-4 py-2.5 text-right font-semibold">Out</th>
                <th className="px-4 py-2.5 text-right font-semibold">Net</th>
                <th className="px-4 py-2.5 text-right font-semibold">Balance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {f.buckets.map((b) => (
                <tr key={b.label} className={clsx("align-top", b.closing < 0 && "bg-red-50/60")}>
                  <td className="whitespace-nowrap px-4 py-2.5 font-medium text-ink">{b.label}</td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-xs text-muted">
                    {day(b.from)} – {day(b.to)}
                    {b.events.length > 0 && (
                      <ul className="mt-1 space-y-0.5">
                        {b.events.map((e, i) => (
                          <li key={`${e.label}-${i}`} className="text-[11px]">
                            <span className={e.amount > 0 ? "text-brand-green-700" : "text-muted"}>
                              {day(e.date)} {KIND_LABEL[e.kind]}
                            </span>
                            {e.party ? <span className="text-muted"> · {e.party}</span> : null}
                            {e.overdue ? <span className="text-red-600"> · overdue</span> : null}
                            {e.certainty === "estimated" ? <span className="text-muted"> · estimated</span> : null}
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-brand-green-700">{b.moneyIn ? n(b.moneyIn) : "—"}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-red-600">{b.moneyOut ? n(b.moneyOut) : "—"}</td>
                  <td className={clsx("px-4 py-2.5 text-right tabular-nums", b.net < 0 ? "text-red-600" : "text-ink")}>{n(b.net)}</td>
                  <td className={clsx("px-4 py-2.5 text-right font-semibold tabular-nums", b.closing < 0 ? "text-red-600" : "text-heading")}>{n(b.closing)}</td>
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
            <span className="font-medium text-ink">Where these figures come from:</span> the balance on
            accounts you have marked as Cash, post-dated cheques not yet settled, unpaid invoices on their
            due dates, retention on its release date, and payroll on the {source.payroll.dayOfMonth}
            {source.payroll.dayOfMonth === 1 ? "st" : source.payroll.dayOfMonth === 2 ? "nd" : source.payroll.dayOfMonth === 3 ? "rd" : "th"} of
            each month{source.payroll.fromPeriod ? ` at ${n(source.payroll.amount)}, the total of ${source.payroll.fromPeriod}` : ""}.
          </p>
          <p className="mt-2">
            A cheque a customer has already given you is not counted again as an unpaid invoice. Payday
            and the accounts treated as Cash are both settings — Finance → Setup, and the account itself.
          </p>
          {f.beyondHorizon.moneyIn > 0 || f.beyondHorizon.moneyOut > 0 ? (
            <p className="mt-2">
              Beyond these {weeks} weeks there is a further {n(f.beyondHorizon.moneyIn)} due in and{" "}
              {n(f.beyondHorizon.moneyOut)} due out. It is not in the balances above.
            </p>
          ) : null}
          {cautious && f.excluded.count > 0 ? (
            <p className="mt-2">
              The cautious view has left out {f.excluded.count} uncertain receipt
              {f.excluded.count === 1 ? "" : "s"} worth {n(f.excluded.amount)} — overdue invoices and
              retention you still have to chase. Money you owe is never left out.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function Tile({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: "green" | "red" }) {
  return (
    <div className="card p-5">
      <div className="text-sm text-muted">{label}</div>
      <div className={clsx(
        "mt-1 text-2xl font-bold tabular-nums",
        accent === "green" ? "text-brand-green-700" : accent === "red" ? "text-red-600" : "text-heading",
      )}>
        {value}
      </div>
      {sub ? <div className="mt-0.5 truncate text-xs text-muted" title={sub}>{sub}</div> : null}
    </div>
  );
}
