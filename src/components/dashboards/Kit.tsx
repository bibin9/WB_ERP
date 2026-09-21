import Link from "next/link";
import clsx from "clsx";
import { ArrowRight } from "lucide-react";

/**
 * The pieces every module dashboard is built from.
 *
 * A module dashboard answers "what needs me today, and how are we doing" for
 * one module, where the main dashboard answers it across all of them. Every
 * figure is a link to the screen it came from, and every figure is shown only
 * to someone who may open that screen — the dashboard never shows more than
 * the module does.
 */

export const aed = (v: number) => `AED ${Math.round(v).toLocaleString()}`;
/** AED 1.2M / AED 350K — for tiles, where the full figure does not fit. */
export const aedShort = (v: number) => {
  const a = Math.abs(v);
  const s = a >= 1e6 ? `${(a / 1e6).toFixed(a >= 1e7 ? 0 : 1)}M` : a >= 1e4 ? `${Math.round(a / 1e3)}K` : Math.round(a).toLocaleString();
  return `${v < 0 ? "−" : ""}AED ${s}`;
};

type Tone = "neutral" | "good" | "warn" | "bad";
const toneText: Record<Tone, string> = {
  neutral: "text-ink",
  good: "text-brand-green-700",
  warn: "text-brand-gold",
  bad: "text-red-600",
};
const toneStripe: Record<Tone, string> = {
  neutral: "bg-line",
  good: "bg-brand-green",
  warn: "bg-brand-gold",
  bad: "bg-red-500",
};

/** One headline figure. `hint` says in plain words what the number is. */
export function Tile({ label, value, hint, href, tone = "neutral" }: { label: string; value: string; hint: string; href?: string; tone?: Tone }) {
  const body = (
    <div className="stat-card relative h-full overflow-hidden">
      <span className={clsx("absolute inset-x-0 top-0 h-1", toneStripe[tone])} />
      <div className={clsx("text-2xl font-bold tabular-nums", toneText[tone])}>{value}</div>
      <div className="mt-1 text-sm font-medium text-heading">{label}</div>
      <div className="mt-0.5 text-xs text-muted">{hint}</div>
    </div>
  );
  return href ? <Link href={href} className="block h-full transition-opacity hover:opacity-90">{body}</Link> : body;
}

export function Tiles({ children }: { children: React.ReactNode }) {
  return <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">{children}</div>;
}

export function Sections({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">{children}</div>;
}

/** A panel of related figures, with a link to the screen that holds them. */
export function Section({ title, hint, href, children }: { title: string; hint?: string; href?: string; children: React.ReactNode }) {
  return (
    <section className="card p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold text-heading">{title}</h2>
          {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
        </div>
        {href && (
          <Link href={href} className="flex shrink-0 items-center gap-1 text-sm font-medium text-brand-blue-600 hover:underline">
            Open <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        )}
      </div>
      {children}
    </section>
  );
}

/** A labelled figure inside a section. */
export function Figure({ label, value, tone = "neutral", sub }: { label: string; value: string; tone?: Tone; sub?: string }) {
  return (
    <div className="rounded-lg bg-brand-paper p-3">
      <div className={clsx("text-lg font-bold tabular-nums", toneText[tone])}>{value}</div>
      <div className="text-xs text-muted">{label}</div>
      {sub && <div className="text-[11px] text-muted/80">{sub}</div>}
    </div>
  );
}

export function Figures({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{children}</div>;
}

/** A list of things that need someone, most urgent first. */
export function List({ rows, empty }: { rows: { key: string; href: string; label: string; right: string; tone?: Tone }[]; empty: string }) {
  if (!rows.length) return <p className="rounded-lg bg-brand-paper px-3 py-4 text-center text-sm text-muted">{empty}</p>;
  return (
    <div className="divide-y divide-line rounded-lg border border-line">
      {rows.map((r) => (
        <Link key={r.key} href={r.href} className="flex items-center justify-between gap-3 px-3 py-2 text-sm hover:bg-brand-paper">
          <span className="min-w-0 truncate text-ink">{r.label}</span>
          <span className={clsx("shrink-0 text-xs font-medium tabular-nums", toneText[r.tone ?? "neutral"])}>{r.right}</span>
        </Link>
      ))}
    </div>
  );
}

/** A line with a count on the right — a thing to look at, and how many. */
export function Line({ label, value, href, tone = "neutral" }: { label: string; value: string; href: string; tone?: Tone }) {
  return (
    <Link href={href} className="mt-2 flex items-center justify-between rounded-lg border border-line px-3 py-2 text-sm hover:bg-brand-paper">
      <span className="text-muted">{label}</span>
      <span className={clsx("font-semibold tabular-nums", toneText[tone])}>{value}</span>
    </Link>
  );
}

/**
 * Horizontal bars on one scale — a pipeline by stage, stock by store. The
 * longest bar is the largest value; each row says its own figure, so nobody
 * has to read a length.
 */
export function Bars({ rows, format = (n: number) => n.toLocaleString() }: { rows: { label: string; value: number; note?: string }[]; format?: (n: number) => string }) {
  const max = Math.max(0, ...rows.map((r) => r.value));
  return (
    <div className="space-y-2">
      {rows.map((r) => (
        <div key={r.label} className="text-sm">
          <div className="mb-1 flex items-baseline justify-between gap-3">
            <span className="text-ink">{r.label}{r.note && <span className="ml-1.5 text-xs text-muted">{r.note}</span>}</span>
            <span className="tabular-nums text-muted">{format(r.value)}</span>
          </div>
          <div className="h-2 rounded-full bg-brand-paper">
            <div className="h-2 rounded-full bg-brand-blue" style={{ width: max > 0 ? `${Math.max(2, (r.value / max) * 100)}%` : "0%" }} />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Two series by month on one scale — money in against money out. Columns
 * rather than a line: six months is six things to compare, not a trend.
 */
export function MonthColumns({ months, a, b, format }: {
  months: { label: string; a: number; b: number }[];
  a: string;
  b: string;
  format: (n: number) => string;
}) {
  const max = Math.max(0, ...months.flatMap((m) => [m.a, m.b]));
  const h = (v: number) => (max > 0 && v > 0 ? `${Math.max(2, (v / max) * 100)}%` : "0%");
  return (
    <div>
      <div className="mb-2 flex gap-4 text-xs text-muted">
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-brand-green" /> {a}</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-brand-gold" /> {b}</span>
        <span className="grow" />
        <span>Highest: {format(max)}</span>
      </div>
      <div className="flex h-36 items-end gap-2 border-b border-line">
        {months.map((m) => (
          <div key={m.label} className="flex h-full flex-1 items-end justify-center gap-1" title={`${m.label}: ${a} ${format(m.a)}, ${b} ${format(m.b)}`}>
            <div className="w-1/3 rounded-t bg-brand-green" style={{ height: h(m.a) }} />
            <div className="w-1/3 rounded-t bg-brand-gold" style={{ height: h(m.b) }} />
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-2 text-center text-[11px] text-muted">
        {months.map((m) => <span key={m.label} className="flex-1">{m.label}</span>)}
      </div>
    </div>
  );
}

/** Shown when someone can open the module but none of the screens that feed its figures. */
export function NothingToShow() {
  return (
    <div className="card p-10 text-center text-sm text-muted">
      None of the figures on this dashboard come from screens you can open. Use the tabs above to go to the screens you work in.
    </div>
  );
}

export const plural = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`;
export const daysFrom = (d: Date, now = new Date()) => Math.ceil((d.getTime() - now.getTime()) / 86400000);
export const dueText = (days: number) => (days < 0 ? `${-days}d overdue` : days === 0 ? "today" : `in ${days}d`);
