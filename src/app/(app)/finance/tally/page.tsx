import { RefreshCw, Info } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import CompanyPicker from "@/components/CompanyPicker";
import FinanceTabs from "@/components/FinanceTabs";
import TallyControls from "@/components/tally/TallyControls";
import { saveTallyConfig } from "./actions";
import { requireAccess } from "@/lib/guard";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function TallyPage({ searchParams }: { searchParams: Promise<{ c?: string }> }) {
  await requireAccess("finance.tally");
  const session = await getSession();
  const sp = await searchParams;
  const accessible = session?.companies ?? [];
  const companyId = accessible.find((c) => c.id === sp.c)?.id ?? accessible[0]?.id ?? "";
  const cfg = companyId ? await db.tallyConfig.findUnique({ where: { companyId } }) : null;
  const importedCount = companyId ? await db.chartOfAccount.count({ where: { companyId, tallyGuid: { not: null } } }) : 0;

  return (
    <div>
      <PageHeader title="Finance — Tally Integration" subtitle="Connect your existing Tally and import its ledgers into the group books." />
      <FinanceTabs companyId={companyId} />
      <div className="mb-5"><CompanyPicker companies={accessible.map((c) => ({ id: c.id, code: c.code, name: c.name }))} current={companyId} /></div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* Connection settings */}
        <div className="card p-5">
          <div className="mb-4 flex items-center gap-2 text-brand-navy">
            <RefreshCw className="h-5 w-5" /><h2 className="font-semibold">Connection settings</h2>
          </div>
          <form action={saveTallyConfig} className="space-y-3">
            <input type="hidden" name="companyId" value={companyId} />
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <label className="mb-1 block text-sm font-medium text-ink">Tally host / IP</label>
                <input name="host" className="input" defaultValue={cfg?.host ?? "localhost"} placeholder="e.g. 192.168.1.20" />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-ink">Port</label>
                <input name="port" type="number" className="input" defaultValue={cfg?.port ?? 9000} />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-ink">Tally company name</label>
              <input name="tallyCompany" className="input" defaultValue={cfg?.tallyCompany ?? ""} placeholder="Exact company name as in Tally" />
            </div>
            <button type="submit" className="btn-navy">Save settings</button>
          </form>

          <div className="mt-5 border-t border-line pt-4">
            <div className="mb-2 text-sm font-medium text-ink">Sync</div>
            <TallyControls companyId={companyId} />
            {cfg?.lastSyncInfo && (
              <p className="mt-3 text-xs text-muted">
                Last sync: {cfg.lastSyncAt ? new Date(cfg.lastSyncAt).toLocaleString("en-GB") : "—"} · {cfg.lastSyncInfo}
              </p>
            )}
            {importedCount > 0 && <p className="mt-1 text-xs text-brand-green-700">{importedCount} account(s) linked to Tally.</p>}
          </div>
        </div>

        {/* How-to */}
        <div className="card p-5">
          <div className="mb-3 flex items-center gap-2 text-brand-navy">
            <Info className="h-5 w-5" /><h2 className="font-semibold">How the integration works</h2>
          </div>
          <ol className="list-decimal space-y-2 pl-5 text-sm text-muted">
            <li>In Tally, open the company and enable the HTTP gateway: <span className="text-ink">Gateway of Tally → F1 (Help) → Settings → Connectivity → Client/Server → set “Act as: Both / Server”, port 9000</span>.</li>
            <li>Make sure this server can reach the Tally machine on that host/port (same LAN / firewall open).</li>
            <li>Enter the host, port and the exact Tally company name above, and Save.</li>
            <li><span className="text-ink">Test connection</span> confirms Tally is reachable and lists the open companies.</li>
            <li><span className="text-ink">Import ledgers</span> pulls all Tally ledgers into this company’s chart of accounts (mapped to Asset/Liability/Income/Expense/Equity by their Tally group).</li>
          </ol>
          <div className="mt-4 rounded-lg bg-brand-blue/5 p-3 text-xs text-muted">
            <span className="font-medium text-ink">Note:</span> the sync runs from the server to your Tally over its XML/HTTP API. It only works when Tally is running with HTTP enabled and reachable — otherwise “Test connection” will report exactly what’s wrong. Voucher (transaction) import and push-back are the next step once ledger mapping is confirmed.
          </div>
        </div>
      </div>
    </div>
  );
}
