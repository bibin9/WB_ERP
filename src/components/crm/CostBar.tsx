import { money } from "@/lib/money";
import type { EstimateTotals } from "@/lib/estimating";

/**
 * Where the money in a price actually goes.
 *
 * One bar, in the order the money is added: the four direct costs, then the
 * overhead, then what is left as profit. That order is not decoration — it is
 * the rule the module turns on. Seeing the gold band sitting inside the price
 * rather than eating the green one is the difference between an estimate that
 * pays and one that does not.
 *
 * Shades of blue for direct cost, gold for overhead, green for profit, so the
 * three kinds of money read apart at a glance without needing the legend.
 */
const BANDS = [
  { key: "material", label: "Material", tone: "bg-brand-blue-600" },
  { key: "labour", label: "Labour", tone: "bg-brand-blue-600/70" },
  { key: "plant", label: "Plant", tone: "bg-brand-blue-600/45" },
  { key: "subcontract", label: "Subcontract", tone: "bg-brand-blue-600/25" },
  { key: "indirect", label: "Overhead", tone: "bg-brand-gold" },
  { key: "profit", label: "Profit", tone: "bg-brand-green" },
] as const;

export default function CostBar({ totals }: { totals: EstimateTotals }) {
  const values: Record<string, number> = {
    material: totals.material,
    labour: totals.labour,
    plant: totals.plant,
    subcontract: totals.subcontract,
    indirect: totals.indirect,
    profit: Math.max(0, totals.profit),
  };

  const whole = BANDS.reduce((s, b) => s + values[b.key], 0);
  const shown = BANDS.filter((b) => values[b.key] > 0);

  if (whole <= 0) {
    return (
      <p className="py-4 text-center text-sm text-muted">
        Nothing costed yet. Add a line and its build-up, and the price will draw itself here.
      </p>
    );
  }

  return (
    <div>
      <div className="flex h-8 w-full overflow-hidden rounded">
        {shown.map((b) => {
          const share = values[b.key] / whole;
          return (
            <div
              key={b.key}
              className={`${b.tone} relative flex items-center justify-center`}
              style={{ width: `${share * 100}%` }}
              title={`${b.label}: ${money(values[b.key])} — ${(share * 100).toFixed(1)}% of the price`}
            >
              {share > 0.09 && (
                <span className="truncate px-1 text-[10px] font-medium text-white">
                  {(share * 100).toFixed(0)}%
                </span>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
        {shown.map((b) => (
          <span key={b.key} className="inline-flex items-center gap-1.5 text-xs">
            <span className={`h-2.5 w-2.5 shrink-0 rounded-sm ${b.tone}`} />
            <span className="text-muted">{b.label}</span>
            <span className="tabular-nums text-ink">{money(values[b.key])}</span>
          </span>
        ))}
      </div>

      {totals.profit < 0 && (
        <p className="mt-3 rounded bg-brand-gold/10 px-2 py-1.5 text-xs text-ink">
          <span className="font-semibold">This price is below cost.</span> There is no profit band because there
          is no profit — the quote is {money(Math.abs(totals.profit))} short of what the work takes.
        </p>
      )}
    </div>
  );
}
