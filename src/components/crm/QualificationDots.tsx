import { qualify, type LeadLike } from "@/lib/leads";

/**
 * How much is known about an enquiry, as five lamps.
 *
 * "3/5" is a number somebody has to decode. Five segments, three lit, is a
 * thing you read without thinking — and hovering any one of them says which
 * question it is, so the next action is obvious rather than needing looking up.
 *
 * The lamps and their labels both come from `qualify`, so a question added to
 * the rules appears here without anybody remembering to add it, and no lamp
 * can end up labelled with somebody else's question.
 *
 * Amber below three rather than red: a new enquiry knows almost nothing and
 * that is not a fault, it is Tuesday. Red would train people to ignore it.
 */
export default function QualificationDots({
  lead,
  showCount = true,
}: {
  lead: LeadLike;
  showCount?: boolean;
}) {
  const q = qualify(lead);

  const tone =
    q.answered === q.of
      ? "bg-brand-green"
      : q.answered >= 3
        ? "bg-brand-blue-600"
        : "bg-brand-gold";

  return (
    <span
      className="inline-flex items-center gap-1.5"
      title={q.missing.length ? `Still to find out: ${q.missing.join("; ")}` : "Everything is known about this one"}
    >
      <span className="flex gap-0.5">
        {q.questions.map((question) => (
          <span
            key={question.key}
            title={`${question.label}${question.answered ? "" : " — not yet"}`}
            className={`h-1.5 w-4 rounded-sm ${question.answered ? tone : "bg-line"}`}
          />
        ))}
      </span>
      {showCount && (
        <span className="text-xs tabular-nums text-muted">
          {q.answered}/{q.of}
        </span>
      )}
    </span>
  );
}
