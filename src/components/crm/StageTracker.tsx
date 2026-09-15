import { Check, X, Circle } from "lucide-react";
import { LEAD_STAGES, CLOSED_STAGES, STAGE_HELP, stageProbability } from "@/lib/leads";

/** The stages an enquiry walks through, in order. Won and Lost are endings. */
const PATH = LEAD_STAGES.filter((s) => !CLOSED_STAGES.has(s));

/**
 * Where an enquiry has got to, as a picture (CRM-02).
 *
 * The same shape as tracking a parcel, because that is the thing everybody has
 * already learned to read: what is done, where it is now, what is still to
 * come. A dropdown saying "Estimating" tells you the stage; it does not tell
 * you that two steps were skipped or that this one has been sitting here for
 * three weeks.
 *
 * A lost enquiry keeps its path and gets a different ending, so the board shows
 * how far it got before it went. Losing at Negotiating and losing at New are
 * different events and should not look the same.
 */
export default function StageTracker({
  stage,
  closedFrom,
  compact = false,
}: {
  stage: string;
  /** The stage it had reached when it was won or lost. */
  closedFrom?: string | null;
  compact?: boolean;
}) {
  const lost = stage === "Lost";
  const won = stage === "Won";
  const closed = lost || won;

  const path = PATH as readonly string[];

  /**
   * How far it actually got.
   *
   * A closed enquiry stopped somewhere, and that somewhere is the point of the
   * picture: losing at Quoted and losing at New are completely different
   * events, and the second is much the worse news. Older rows have no recorded
   * stopping point, so they fall back to the whole path rather than claiming a
   * precision nobody has.
   */
  const reached = closed && closedFrom && path.includes(closedFrom)
    ? path.indexOf(closedFrom) + 1
    : closed
      ? path.length
      : path.indexOf(stage);
  const at = reached;

  const steps = [
    ...PATH.map((s, i) => ({
      label: s,
      help: STAGE_HELP[s],
      done: i < at,
      // A closed enquiry has no current stage. The only marker still lit is
      // the ending, or the bar would show a lost deal as though somebody were
      // still working on it.
      here: !closed && i === at,
      // Stages it never got to, on an enquiry that has stopped. Drawn faint so
      // the gap between where it went and where it could have gone is visible.
      never: closed && i >= at,
      pct: Math.round(stageProbability(s) * 100),
    })),
    {
      label: won ? "Won" : lost ? "Lost" : "Won",
      help: won ? STAGE_HELP["Won"] : lost ? STAGE_HELP["Lost"] : "Not decided yet.",
      done: false,
      here: closed,
      never: false,
      pct: won ? 100 : 0,
    },
  ];

  return (
    <ol className={`flex w-full items-start ${compact ? "gap-0" : "gap-0"}`} aria-label="Progress">
      {steps.map((s, i) => {
        const last = i === steps.length - 1;
        const ending = last && closed;
        return (
          <li key={s.label + i} className="flex min-w-0 flex-1 flex-col items-center">
            <div className="flex w-full items-center">
              {/* the line coming in */}
              <span
                className={`h-0.5 flex-1 ${i === 0 ? "opacity-0" : s.done || s.here ? "bg-brand-blue-600" : "bg-line"}`}
              />
              <span
                title={s.help}
                className={`grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 ${
                  ending && lost
                    ? "border-brand-gold bg-brand-gold text-white"
                    : ending && won
                      ? "border-brand-green bg-brand-green text-white"
                      : s.done
                        ? "border-brand-blue-600 bg-brand-blue-600 text-white"
                        : s.here
                          ? "border-brand-blue-600 bg-surface text-brand-blue-600"
                          : s.never
                            ? "border-dashed border-line bg-surface text-muted opacity-50"
                            : "border-line bg-surface text-muted"
                }`}
              >
                {ending && lost ? (
                  <X className="h-3 w-3" strokeWidth={3} />
                ) : s.done || (ending && won) ? (
                  <Check className="h-3 w-3" strokeWidth={3} />
                ) : s.here ? (
                  <Circle className="h-2 w-2 fill-current" />
                ) : (
                  <Circle className="h-1.5 w-1.5 fill-current opacity-40" />
                )}
              </span>
              {/* the line going out */}
              <span
                className={`h-0.5 flex-1 ${last ? "opacity-0" : s.done ? "bg-brand-blue-600" : "bg-line"}`}
              />
            </div>

            {!compact && (
              <div className="mt-1.5 px-1 text-center">
                <div
                  className={`truncate text-xs ${
                    s.here ? "font-medium text-heading" : s.done ? "text-ink" : s.never ? "text-muted opacity-50" : "text-muted"
                  }`}
                  title={s.label}
                >
                  {s.label}
                </div>
                {!last && <div className="text-[10px] tabular-nums text-muted">{s.pct}%</div>}
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
