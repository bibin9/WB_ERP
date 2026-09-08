import { Users } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import CompanyPicker from "@/components/CompanyPicker";
import FinanceTabs from "@/components/FinanceTabs";
import PartyForm from "@/components/finance/PartyForm";
import GuardedDelete from "@/components/GuardedDelete";
import ActiveToggle from "@/components/ActiveToggle";
import { deleteParty, setPartyActive } from "./actions";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { requireAccess } from "@/lib/guard";
import Pager from "@/components/Pager";
import { readPaging, pageInfo } from "@/lib/paging";
import SearchBox from "@/components/SearchBox";
import { readSearch, matchAny } from "@/lib/search";

export const dynamic = "force-dynamic";

const typeColor: Record<string, string> = {
  Customer: "bg-brand-blue/10 text-brand-blue-600",
  Supplier: "bg-brand-gold/10 text-brand-gold",
  Both: "bg-brand-green/10 text-brand-green-700",
};

export default async function PartiesPage({ searchParams }: { searchParams: Promise<{ c?: string; p?: string; per?: string; q?: string }> }) {
  await requireAccess("finance.parties");
  const session = await getSession();
  const sp = await searchParams;
  const accessible = session?.companies ?? [];
  const companyId = accessible.find((c) => c.id === sp.c)?.id ?? accessible[0]?.id ?? "";

  // A party list grows with the business, so one page is fetched at a time.
  const term = readSearch(sp);
  const partyWhere = {
    companyId,
    ...(matchAny(term, ["name", "code", "trn", "contactPerson", "phone", "email"]) ?? {}),
  };
  const paging = readPaging(sp);
  const partyTotal = companyId ? await db.party.count({ where: partyWhere }) : 0;
  const info = pageInfo(paging, partyTotal);

  const parties = companyId
    ? await db.party.findMany({
        where: partyWhere,
        include: { _count: { select: { entries: true } } },
        orderBy: [{ isActive: "desc" }, { code: "asc" }],
        skip: (info.page - 1) * info.perPage,
        take: info.perPage,
      })
    : [];

  const customers = parties.filter((p) => p.type !== "Supplier").length;
  const suppliers = parties.filter((p) => p.type !== "Customer").length;

  return (
    <div>
      <PageHeader
        title="Finance — Customers & Suppliers"
        subtitle="One record per party, so names stay consistent, the TRN is on hand for tax invoices, and outstanding can be totalled."
      >
        {companyId && <PartyForm companyId={companyId} />}
      </PageHeader>
      <FinanceTabs companyId={companyId} />

      <div className="mb-5"><CompanyPicker companies={accessible.map((c) => ({ id: c.id, code: c.code, name: c.name }))} current={companyId} /></div>

      <div className="mb-4">
        <SearchBox placeholder="Search customers and suppliers…" hint="Name, code, TRN, contact person, phone or email." />
      </div>

      <div className="card">
        <div className="flex items-center gap-2 border-b border-line px-5 py-3">
          <Users className="h-5 w-5 text-heading" />
          <h2 className="font-semibold text-heading">Parties</h2>
          <span className="ml-auto text-xs text-muted">{customers} customer(s) · {suppliers} supplier(s)</span>
        </div>

        {parties.length === 0 ? (
          <div className="px-5 py-14 text-center text-sm text-muted">
            No customers or suppliers yet. Add them here and they become selectable on every voucher —
            which is what makes the outstanding report possible.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line bg-brand-paper text-left text-xs uppercase text-muted">
                  <th className="px-4 py-2 font-semibold">Code</th>
                  <th className="px-4 py-2 font-semibold">Name</th>
                  <th className="px-4 py-2 font-semibold">Type</th>
                  <th className="px-4 py-2 font-semibold">TRN</th>
                  <th className="px-4 py-2 font-semibold">Contact</th>
                  <th className="px-4 py-2 text-right font-semibold">Credit days</th>
                  <th className="px-4 py-2 text-right font-semibold">Vouchers</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {parties.map((p) => (
                  <tr key={p.id} className={p.isActive ? "" : "opacity-50"}>
                    <td className="px-4 py-2.5 font-mono text-xs text-heading">{p.code}</td>
                    <td className="px-4 py-2.5 font-medium text-ink">{p.name}</td>
                    <td className="px-4 py-2.5">
                      <span className={`rounded px-2 py-0.5 text-xs font-medium ${typeColor[p.type] ?? typeColor.Customer}`}>{p.type}</span>
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs text-muted">{p.trn ?? "—"}</td>
                    <td className="px-4 py-2.5 text-muted">
                      {p.contactPerson ?? "—"}
                      {p.phone && <span className="block text-xs">{p.phone}</span>}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-muted">{p.creditDays || "—"}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-muted">{p._count.entries}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center justify-end gap-1">
                        <PartyForm
                          companyId={companyId}
                          party={{
                            id: p.id, name: p.name, type: p.type, trn: p.trn,
                            contactPerson: p.contactPerson, email: p.email, phone: p.phone,
                            address: p.address, creditDays: p.creditDays,
                          }}
                        />
                        <ActiveToggle isActive={p.isActive} action={async (next) => { "use server"; await setPartyActive(p.id, next); }} />
                        <GuardedDelete
                          screen="finance.parties"
                          action={deleteParty.bind(null, p.id)}
                          label={`Delete ${p.name}?`}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pager info={info} label="parties" />
          </div>
        )}
      </div>
    </div>
  );
}
