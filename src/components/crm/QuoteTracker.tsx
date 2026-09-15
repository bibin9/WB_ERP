import { Check, X, Circle, FileText } from "lucide-react";
import { QUOTE_STATUS_HELP } from "@/lib/quoting";

/**
 * The path a quotation takes, as a picture.
 *
 * Drafted, signed off, sent, decided. Four steps, because that is genuinely
 * how many there are and a tracker with more invented stages on it teaches
 * people to ignore it.
 *
 * Declined keeps the path and gets a different ending, the same way a lost
 * enquiry does: a quotation declined after it went out and one that never got
 * approved are different failures, and only one of them is the customer's
 * fault.
 */
const PATH = [
  { key: "Draft", label: "Drafted", help: QUOTE_STATUS_HELP["Draft"] },
  { key: "Awaiting approval", label: "Approval", help: QUOTE_STATUS_HELP["Awaiting approval"] },
  { key: "Issued", label: "Sent", help: QUOTE_STATUS_HELP["Issued"] },
];

export default function QuoteTracker({ status }: { status: string }) {
  const accepted = status === "Accepted";
  const declined = status === "Declined";
  const superseded = status === "Superseded";
  const decided = accepted || declined;

  // How far it got. Approved sits between waiting and sent, so it counts as
  // having cleared the approval step.
  const reached =
    decided || status === "Issued" ? 3
      : status === "Approved" ? 2
        : status === "Awaiting approval" ? 1
          : 0;

  const steps = [
    ...PATH.map((s, i) => ({
      label: s.label,
      help: s.help,
      done: i < reached,
      here: !decided && i === reached,
      never: decided && i >= reached,
    })),
    {
      label: accepted ? "Won" : declined ? "Declined" : superseded ? "Replaced" : "Decided",
      help: accepted
        ? QUOTE_STATUS_HELP["Accepted"]
        : declined
          ? QUOTE_STATUS_HELP["Declined"]
          : superseded
            ? QUOTE_STATUS_HELP["Superseded"]
            : "Waiting on the customer.",
      done: false,
      here: decided || superseded,
      never: false,
    },
  ];

  return (
    <ol className="flex w-full items-start" aria-label="Progress">
      {steps.map((s, i) => {
        const last = i === steps.length - 1;
        const ending = last && (decided || superseded);
        return (
          <li key={s.label} className="flex min-w-0 flex-1 flex-col items-center">
            <div className="flex w-full items-center">
              <span
                className={`h-0.5 flex-1 ${i === 0 ? "opacity-0" : s.done || s.here ? "bg-brand-blue-600" : "bg-line"}`}
              />
              <span
                title={s.help}
                className={`grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 ${
                  ending && accepted
                    ? "border-brand-green bg-brand-green text-white"
                    : ending && declined
                      ? "border-brand-gold bg-brand-gold text-white"
                      : ending && superseded
                        ? "border-line bg-line text-muted"
                        : s.done
                          ? "border-brand-blue-600 bg-brand-blue-600 text-white"
                          : s.here
                            ? "border-brand-blue-600 bg-surface text-brand-blue-600"
                            : s.never
                              ? "border-dashed border-line bg-surface text-muted opacity-50"
                              : "border-line bg-surface text-muted"
                }`}
              >
                {ending && declined ? (
                  <X className="h-3 w-3" strokeWidth={3} />
                ) : ending && superseded ? (
                  <FileText className="h-3 w-3" />
                ) : s.done || (ending && accepted) ? (
                  <Check className="h-3 w-3" strokeWidth={3} />
                ) : s.here ? (
                  <Circle className="h-2 w-2 fill-current" />
                ) : (
                  <Circle className="h-1.5 w-1.5 fill-current opacity-40" />
                )}
              </span>
              <span className={`h-0.5 flex-1 ${last ? "opacity-0" : s.done ? "bg-brand-blue-600" : "bg-line"}`} />
            </div>
            <div
              className={`mt-1.5 truncate px-1 text-center text-xs ${
                s.here ? "font-medium text-heading" : s.done ? "text-ink" : s.never ? "text-muted opacity-50" : "text-muted"
              }`}
            >
              {s.label}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
