"use client";

import { useState, useTransition } from "react";
import { setLineCleared } from "@/app/(app)/finance/bank-rec/actions";

/**
 * The tick against one line.
 *
 * Deliberately a plain checkbox rather than a dialog: reconciling a month means
 * going down forty lines with the statement beside you, and anything that asks
 * a question each time does not get used. The date and statement reference come
 * from the header, because they are the same for every line on that statement.
 */
export default function ClearLine({
  lineId,
  cleared,
  statementDate,
  statementRef,
}: {
  lineId: string;
  cleared: boolean;
  statementDate: string;
  statementRef: string;
}) {
  const [on, setOn] = useState(cleared);
  const [pending, start] = useTransition();
  const [error, setError] = useState("");

  return (
    <span className="inline-flex items-center gap-1">
      <input
        type="checkbox"
        checked={on}
        disabled={pending}
        aria-label={on ? "Mark as not on the statement" : "Mark as on the statement"}
        className="h-4 w-4 rounded border-line disabled:opacity-50"
        onChange={(e) => {
          const next = e.target.checked;
          setOn(next); // answer immediately; forty of these in a row must feel instant
          setError("");
          start(async () => {
            const res = await setLineCleared(lineId, next, statementDate, statementRef);
            if (!res.ok) {
              setOn(!next);
              setError(res.error ?? "Could not save");
            }
          });
        }}
      />
      {error && <span className="text-xs text-brand-gold" title={error}>!</span>}
    </span>
  );
}
