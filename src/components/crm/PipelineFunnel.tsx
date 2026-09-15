import { LEAD_STAGES, CLOSED_STAGES, STAGE_HELP, stageProbability } from "@/lib/leads";
import { money } from "@/lib/money";

const OPEN_STAGES = LEAD_STAGES.filter((s) => !CLOSED_STAGES.has(s));

/**
 * The shape of the pipeline, stage by stage.
 *
 * Bars rather than a tapered funnel drawing, for one reason: a real pipeline
 * does not taper. Deals pile up wherever they get stuck, and a picture that
 * narrows by design would draw a tidy shape over the very thing worth seeing —
 * forty enquiries sitting at Estimating because nobody has priced them.
 *
 * Each bar is drawn against the biggest stage, not against the first, so the
 * longest bar is the blockage.
 */
export default function PipelineFunnel({
  byStage,
}: {
  byStage: Record<string, { count: number; gross: number; weighted: number }>;
}) {
  const rows = OPEN_STAGES.map((stage) => ({
    stage,
    count: byStage[stage]?.count ?? 0,
    gross: byStage[stage]?.gross ?? 0,
    weighted: byStage[stage]?.weighted ?? 0,
  }));

  const widest = Math.max(1, ...rows.map((r) => r.gross));
  const anything = rows.some((r) => r.count > 0);

  if (!anything) {
    return (
      <p className="px-1 py-6 text-center text-sm text-muted">
        Nothing in the pipeline yet. Log an enquiry and it will appear here.
      </p>
    );
  }

  return (
    <div className="space-y-1.5">
      {rows.map((r) => {
        const share = r.gross / widest;
        const weightedShare = r.gross > 0 ? r.weighted / r.gross : 0;
        return (
          <div key={r.stage} className="flex items-center gap-3">
            <div className="w-28 shrink-0 text-right text-xs text-muted" title={STAGE_HELP[r.stage]}>
              {r.stage}
            </div>

            <div className="relative h-7 flex-1 overflow-hidden rounded bg-line/50">
              {/* The gross bar, and inside it the part that is actually weighted. */}
              <div
                className="absolute inset-y-0 left-0 rounded bg-brand-blue/20"
                style={{ width: `${Math.max(share * 100, r.count ? 2 : 0)}%` }}
              />
              <div
                className="absolute inset-y-0 left-0 rounded bg-brand-blue-600"
                style={{ width: `${Math.max(share * weightedShare * 100, r.count ? 1 : 0)}%` }}
                title={`${money(r.weighted)} weighted at ${Math.round(stageProbability(r.stage) * 100)}%`}
              />
              <div className="absolute inset-y-0 left-2 flex items-center text-xs font-medium text-ink mix-blend-normal">
                {r.count > 0 && (
                  <span className="rounded bg-surface/80 px-1 tabular-nums">
                    {r.count} · {money(r.gross)}
                  </span>
                )}
              </div>
            </div>

            <div className="w-24 shrink-0 text-right text-xs tabular-nums text-muted">
              {r.count > 0 ? money(r.weighted) : "—"}
            </div>
          </div>
        );
      })}

      <p className="pt-2 text-xs text-muted">
        <span className="mr-1 inline-block h-2 w-3 rounded-sm bg-brand-blue-600 align-middle" /> weighted
        <span className="mx-1 ml-3 inline-block h-2 w-3 rounded-sm bg-brand-blue/20 align-middle" /> gross.
        Bars are drawn against the biggest stage, so the longest one is where enquiries are piling up.
      </p>
    </div>
  );
}
