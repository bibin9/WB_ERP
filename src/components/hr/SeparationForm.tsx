"use client";

import { useMemo, useState } from "react";
import { UserMinus, Calculator, Info } from "lucide-react";
import { createSeparation } from "@/app/(app)/hr/separation/actions";
import { computeSettlement, type SeparationType } from "@/lib/settlement";

type Emp = { id: string; empNo: string; name: string; basicSalary: number; allowances: number; joinDate: string | null; annualLeaveBalance: number };
const TYPES: SeparationType[] = ["Resignation", "Termination", "Termination (Misconduct)"];
const aed = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const todayISO = () => new Date().toISOString().slice(0, 10);

export default function SeparationForm({ employees }: { employees: Emp[] }) {
  const [empId, setEmpId] = useState("");
  const [type, setType] = useState<SeparationType>("Resignation");
  const [lastDay, setLastDay] = useState(todayISO());
  const [forfeit, setForfeit] = useState(false);
  const [f, setF] = useState({ pendingSalary: "", noticePay: "", airTicket: "", otherAdditions: "", deductions: "", adjustment: "" });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF((p) => ({ ...p, [k]: e.target.value }));

  const emp = employees.find((e) => e.id === empId);
  const misconduct = type === "Termination (Misconduct)";

  const s = useMemo(() => {
    if (!emp || !lastDay) return null;
    return computeSettlement({
      basicSalary: emp.basicSalary,
      joinDate: emp.joinDate ? new Date(emp.joinDate) : new Date(),
      lastWorkingDay: new Date(lastDay),
      leaveBalanceDays: emp.annualLeaveBalance,
      separationType: type,
      forfeitGratuity: forfeit || misconduct,
      pendingSalary: +f.pendingSalary || 0, noticePay: +f.noticePay || 0, airTicket: +f.airTicket || 0,
      otherAdditions: +f.otherAdditions || 0, deductions: +f.deductions || 0, adjustment: +f.adjustment || 0,
    });
  }, [emp, lastDay, type, forfeit, misconduct, f]);

  const Row = ({ label, value, sub, strong, sign }: { label: string; value: number; sub?: string; strong?: boolean; sign?: "+" | "−" }) => (
    <div className={`flex items-start justify-between px-4 py-2 text-sm ${strong ? "font-semibold text-ink" : "text-ink"}`}>
      <span>{label}{sub && <span className="ml-1 text-xs font-normal text-muted">{sub}</span>}</span>
      <span className="tabular-nums">{sign === "−" ? "− " : ""}{aed(value)}</span>
    </div>
  );

  return (
    <form action={createSeparation} className="grid grid-cols-1 gap-5 lg:grid-cols-2">
      {/* Inputs */}
      <div className="card p-5">
        <div className="mb-4 flex items-center gap-2 text-heading"><UserMinus className="h-5 w-5" /><h2 className="font-semibold">Separation details</h2></div>
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-ink">Employee</label>
            <select name="employeeId" value={empId} onChange={(e) => setEmpId(e.target.value)} required className="input">
              <option value="">Select an employee…</option>
              {employees.map((e) => <option key={e.id} value={e.id}>{e.empNo} — {e.name}</option>)}
            </select>
            {emp && <p className="mt-1 text-xs text-muted">Basic AED {aed(emp.basicSalary)} · joined {emp.joinDate ? new Date(emp.joinDate).toLocaleDateString("en-GB") : "—"} · leave balance {emp.annualLeaveBalance}d</p>}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-ink">Type</label>
              <select name="type" value={type} onChange={(e) => setType(e.target.value as SeparationType)} className="input">
                {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-ink">Last working day</label>
              <input name="lastWorkingDay" type="date" value={lastDay} onChange={(e) => setLastDay(e.target.value)} required className="input" />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-ink">Reason (optional)</label>
            <input name="reason" className="input" placeholder="e.g. Resigned for a new opportunity" />
          </div>

          {!misconduct && (
            <label className="flex items-center gap-2 text-sm text-ink">
              <input type="checkbox" name="forfeitGratuity" checked={forfeit} onChange={(e) => setForfeit(e.target.checked)} className="h-4 w-4 accent-[color:rgb(var(--brand-navy))]" />
              Forfeit gratuity (gross misconduct — Art. 44)
            </label>
          )}

          <div className="border-t border-line pt-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Adjustments (HR)</p>
            <div className="grid grid-cols-2 gap-3">
              <Field name="pendingSalary" label="Pending salary" v={f.pendingSalary} on={set("pendingSalary")} />
              <Field name="noticePay" label="Notice pay (in lieu)" v={f.noticePay} on={set("noticePay")} />
              <Field name="airTicket" label="Air ticket" v={f.airTicket} on={set("airTicket")} />
              <Field name="otherAdditions" label="Other additions" v={f.otherAdditions} on={set("otherAdditions")} />
              <Field name="deductions" label="Deductions (loans etc.)" v={f.deductions} on={set("deductions")} />
              <Field name="adjustment" label="Manual adjustment (±)" v={f.adjustment} on={set("adjustment")} />
            </div>
            <div className="mt-3">
              <label className="mb-1 block text-sm font-medium text-ink">Adjustment note (optional)</label>
              <input name="adjustmentNote" className="input" placeholder="Why the manual adjustment was made" />
            </div>
          </div>

          <button type="submit" disabled={!emp} className="btn-primary w-full disabled:opacity-50">
            <UserMinus className="h-4 w-4" /> Record separation &amp; settlement
          </button>
          <p className="text-[11px] text-muted">Saving marks the employee inactive and stores this settlement statement.</p>
        </div>
      </div>

      {/* Live settlement preview */}
      <div className="card overflow-hidden">
        <div className="flex items-center gap-2 border-b border-line px-4 py-3 text-heading"><Calculator className="h-5 w-5" /><h2 className="font-semibold">Settlement (live)</h2></div>
        {!s ? (
          <div className="px-4 py-12 text-center text-sm text-muted">Pick an employee and last working day to see the calculation.</div>
        ) : (
          <div className="py-2">
            <div className="flex items-center justify-between px-4 py-1.5 text-xs text-muted">
              <span>Service: <span className="font-medium text-ink">{s.service.text}</span></span>
              <span>Daily basic: AED {aed(s.dailyBasic)}</span>
            </div>
            <div className="mx-4 my-1 border-t border-line" />
            <Row label="Gratuity (end of service)" sub={s.gratuity.eligible ? `${s.gratuity.days} days` : ""} value={s.gratuity.amount} />
            {s.gratuity.note && <p className="px-4 pb-1 text-[11px] text-brand-gold">{s.gratuity.note}</p>}
            <Row label="Leave encashment" sub={`${s.leaveDays} days`} value={s.leaveAmount} />
            {s.pendingSalary > 0 && <Row label="Pending salary" value={s.pendingSalary} />}
            {s.noticePay > 0 && <Row label="Notice pay (in lieu)" value={s.noticePay} />}
            {s.airTicket > 0 && <Row label="Air ticket" value={s.airTicket} />}
            {s.otherAdditions > 0 && <Row label="Other additions" value={s.otherAdditions} />}
            <div className="mx-4 my-1 border-t border-line" />
            <Row label="Total entitlements" value={s.totalAdditions} strong />
            {s.deductions > 0 && <Row label="Less: deductions" value={s.deductions} sign="−" />}
            {s.adjustment !== 0 && <Row label="Manual adjustment" value={s.adjustment} />}
            <div className={`mt-1 flex items-center justify-between border-t-2 border-line px-4 py-3 text-base font-bold ${s.netSettlement >= 0 ? "text-brand-green-700" : "text-red-600"}`}>
              <span>Net settlement payable</span>
              <span className="tabular-nums">AED {aed(s.netSettlement)}</span>
            </div>
            <div className="mx-4 mb-3 flex items-start gap-2 rounded-lg bg-brand-blue/5 p-3 text-[11px] text-muted">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-blue-600" />
              <span>Gratuity per UAE Labour Law (Decree-Law 33/2021): 21 days&apos; basic pay per year for the first 5 years, 30 days after, min 1 year of service, capped at 2 years&apos; basic pay. Leave encashment is unused annual-leave days × daily basic. HR can adjust the figures above.</span>
            </div>
          </div>
        )}
      </div>
    </form>
  );
}

function Field({ name, label, v, on }: { name: string; label: string; v: string; on: (e: React.ChangeEvent<HTMLInputElement>) => void }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-ink">{label}</label>
      <input name={name} type="number" step="0.01" value={v} onChange={on} placeholder="0.00" className="input" />
    </div>
  );
}
