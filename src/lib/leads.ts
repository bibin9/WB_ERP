/**
 * Enquiries, and what they are actually worth (CRM-01, CRM-02, CRM-11, CRM-12).
 *
 * The number this module exists to keep honest is the pipeline. Every
 * contractor's sales report says there is forty million in the pipeline, and
 * the figure is usually fiction for three reasons, all of which are prevented
 * here rather than apologised for later.
 *
 * Won and lost leads are not pipeline
 * -----------------------------------
 * A deal that has been won is revenue and belongs on a job; one that has been
 * lost is nothing. Leaving either in the forecast is the commonest way the
 * number becomes meaningless, because it only ever goes up.
 *
 * Probability belongs to the stage, not to the salesman
 * ----------------------------------------------------
 * If each deal carries a probability somebody types, every deal is ninety per
 * cent and the weighted total is the gross total with extra steps. So the
 * probability comes from the stage the deal has actually reached — a fact
 * about where it is, not a feeling about where it is going. Moving a deal
 * forward is then a decision with a visible consequence, which is what makes
 * it worth arguing about.
 *
 * Qualification counts what is KNOWN, not what is hoped
 * ----------------------------------------------------
 * The BRD asks for qualification scoring. A score somebody sets by hand is a
 * measure of how much the salesman likes the customer. This one counts how
 * many of five concrete questions have an answer: is there a budget, is the
 * decision-maker named, is there a date they need it by, has somebody been to
 * site, and is the scope defined. Each is a fact, and a lead scoring two out
 * of five is not a bad lead — it is a lead nobody has done the work on yet,
 * which is a far more useful thing to be told.
 *
 * Not server-only: the pipeline board weights and totals before anything is
 * saved.
 */

export const LEAD_STAGES = [
  "New",
  "Qualifying",
  "Site visit",
  "Estimating",
  "Quoted",
  "Negotiating",
  "Won",
  "Lost",
] as const;
export type LeadStage = (typeof LEAD_STAGES)[number];

/**
 * What reaching a stage says about the chance of winning.
 *
 * Deliberately conservative and deliberately not round numbers all the way up:
 * the jump that matters is Quoted to Negotiating, because a customer who is
 * arguing about the price has decided they want the work done.
 */
export const STAGE_PROBABILITY: Record<string, number> = {
  New: 0.05,
  Qualifying: 0.1,
  "Site visit": 0.2,
  Estimating: 0.3,
  Quoted: 0.4,
  Negotiating: 0.7,
  Won: 1,
  Lost: 0,
};

export const STAGE_HELP: Record<string, string> = {
  New: "Just arrived. Nobody has looked at it properly yet.",
  Qualifying: "Finding out whether it is real: who wants it, what they will spend, and by when.",
  "Site visit": "Somebody is going, or has been. The report is what the estimate is built on.",
  Estimating: "Being priced. Bill of quantities, labour, plant and materials.",
  Quoted: "The quotation is with the customer.",
  Negotiating: "They are talking about price or scope, which means they want the work done.",
  Won: "Theirs to give and they gave it. It becomes a job and leaves the pipeline.",
  Lost: "Gone. Record who won it and why while somebody still remembers.",
};

/** Stages where the deal is finished with, one way or the other. */
export const CLOSED_STAGES: ReadonlySet<string> = new Set(["Won", "Lost"]);

export const LEAD_SOURCES = [
  "Existing customer",
  "Referral",
  "Tender portal",
  "Consultant",
  "Cold approach",
  "Website",
] as const;

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

export type LeadLike = {
  stage: string;
  /** What the work is thought to be worth, as best anybody knows. */
  estimatedValue?: number | null;
  /* The five qualification facts. */
  budgetStated?: number | null;
  decisionMaker?: string | null;
  requiredBy?: string | null;
  /** Whether a site visit report actually exists — derived, never a flag. */
  siteReportOn?: string | null;
  scopeDefined?: boolean | null;
};

/* ======================================================== qualification == */

export type Qualification = {
  answered: number;
  of: number;
  /** Which questions have no answer yet, in words. */
  missing: string[];
  /** Answered out of five, as a fraction. */
  score: number;
};

const QUESTIONS: { key: string; ask: (l: LeadLike) => boolean; missing: string }[] = [
  { key: "budget", ask: (l) => (Number(l.budgetStated) || 0) > 0, missing: "no budget has been stated" },
  { key: "decisionMaker", ask: (l) => !!String(l.decisionMaker ?? "").trim(), missing: "nobody is named as the decision-maker" },
  { key: "requiredBy", ask: (l) => !!l.requiredBy, missing: "no date they need it by" },
  { key: "siteVisit", ask: (l) => !!l.siteReportOn, missing: "nobody has been to site" },
  { key: "scope", ask: (l) => l.scopeDefined === true, missing: "the scope is not defined" },
];

/**
 * How much is known about this lead, out of five.
 *
 * Not a judgement about whether it is a good lead. A low score means nobody
 * has done the work on it yet, which is something a sales manager can act on;
 * a low opinion is not.
 */
export function qualify(lead: LeadLike): Qualification {
  const missing = QUESTIONS.filter((q) => !q.ask(lead)).map((q) => q.missing);
  const answered = QUESTIONS.length - missing.length;
  return {
    answered,
    of: QUESTIONS.length,
    missing,
    score: QUESTIONS.length ? round2(answered / QUESTIONS.length) : 0,
  };
}

/** Whether a site visit report has been received (CRM-12). Derived, never set. */
export function siteReportSubmitted(lead: LeadLike): boolean {
  return !!lead.siteReportOn;
}

/* ============================================================ pipeline == */

export const stageProbability = (stage: string): number => STAGE_PROBABILITY[stage] ?? 0;

export const isOpen = (lead: LeadLike): boolean => !CLOSED_STAGES.has(lead.stage);

/**
 * What one open deal is worth to a forecast.
 *
 * Nil on anything closed. A won deal is revenue and belongs on a job; a lost
 * one is nothing. Either left in the forecast makes it a number that only ever
 * grows, which is the same as no forecast at all.
 */
export function weightedValue(lead: LeadLike): number {
  if (!isOpen(lead)) return 0;
  return round2((Number(lead.estimatedValue) || 0) * stageProbability(lead.stage));
}

export type Pipeline = {
  open: number;
  /** Sum of the estimated values of open deals, unweighted. */
  gross: number;
  /** What those deals are worth once weighted by their stage. */
  weighted: number;
  byStage: Record<string, { count: number; gross: number; weighted: number }>;
  won: number;
  wonValue: number;
  lost: number;
  lostValue: number;
  /** Of the deals that were decided, the share that were won. */
  winRate: number;
  decided: number;
};

export function summarisePipeline(leads: LeadLike[]): Pipeline {
  const p: Pipeline = {
    open: 0, gross: 0, weighted: 0, byStage: {},
    won: 0, wonValue: 0, lost: 0, lostValue: 0, winRate: 0, decided: 0,
  };

  for (const l of leads) {
    const value = Number(l.estimatedValue) || 0;
    const bucket = (p.byStage[l.stage] ??= { count: 0, gross: 0, weighted: 0 });
    bucket.count += 1;
    bucket.gross = round2(bucket.gross + value);

    if (l.stage === "Won") {
      p.won += 1;
      p.wonValue = round2(p.wonValue + value);
      continue;
    }
    if (l.stage === "Lost") {
      p.lost += 1;
      p.lostValue = round2(p.lostValue + value);
      continue;
    }

    p.open += 1;
    p.gross = round2(p.gross + value);
    const w = weightedValue(l);
    p.weighted = round2(p.weighted + w);
    bucket.weighted = round2(bucket.weighted + w);
  }

  p.decided = p.won + p.lost;
  p.winRate = p.decided > 0 ? round2(p.won / p.decided) : 0;
  return p;
}

/* ========================================================== moving on === */

/**
 * Whether a lead may move to this stage, and what it costs if it is a loss.
 *
 * Losing needs a reason, for the same argument the bid comparison makes about
 * awarding away from the lowest quote: it is the only moment anybody still
 * knows. Six months later the file says "Lost" and nobody can tell whether the
 * price was wrong, the programme was wrong, or nobody followed it up.
 */
export function checkStageChange(
  lead: LeadLike,
  to: string,
  detail: { lostReason?: string | null; lostTo?: string | null } = {},
): { ok: true } | { ok: false; error: string } {
  if (!(LEAD_STAGES as readonly string[]).includes(to)) {
    return { ok: false, error: "That is not a stage this lead can be in." };
  }
  if (lead.stage === to) return { ok: false, error: `This lead is already at ${to}.` };

  if (CLOSED_STAGES.has(lead.stage)) {
    return {
      ok: false,
      error:
        `This lead was ${lead.stage.toLowerCase()} and is finished with. ` +
        `Raise a new enquiry if the customer has come back.`,
    };
  }

  if (to === "Lost" && !String(detail.lostReason ?? "").trim()) {
    return {
      ok: false,
      error:
        "Say why it was lost. Six months from now the file will say Lost and nobody " +
        "will be able to tell whether the price was wrong, the programme was wrong, or nobody chased it.",
    };
  }

  return { ok: true };
}

const plural = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`;
const fmt = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 });

/**
 * What the pipeline is actually worth, in a sentence.
 *
 * Leads with the weighted figure rather than the gross, because the gross is
 * the number people quote and the weighted one is the number that is true.
 */
export function pipelineVerdict(leads: LeadLike[]): string {
  const p = summarisePipeline(leads);
  if (!p.open && !p.decided) return "No enquiries yet.";
  if (!p.open) {
    return `Nothing open. ${plural(p.decided, "enquiry", "enquiries")} decided, ${p.won} won.`;
  }

  const parts = [
    `${plural(p.open, "enquiry", "enquiries")} open, worth ${fmt(p.weighted)} weighted against ${fmt(p.gross)} gross.`,
  ];
  if (p.decided >= 5) {
    parts.push(`${Math.round(p.winRate * 100)}% of the ${p.decided} decided so far were won.`);
  } else if (p.decided > 0) {
    parts.push(`Only ${plural(p.decided, "enquiry", "enquiries")} decided so far — too few to call a win rate.`);
  }
  return parts.join(" ");
}

/**
 * What to do next with one lead, in a sentence.
 */
export function leadVerdict(lead: LeadLike): string {
  if (lead.stage === "Won") return "Won. It should be a job now.";
  if (lead.stage === "Lost") return "Lost.";

  const q = qualify(lead);
  if (q.missing.length === 0) {
    return `Everything is known about this one. Worth ${fmt(weightedValue(lead))} weighted at ${lead.stage}.`;
  }
  const first = q.missing.slice(0, 2).join(", and ");
  return `${q.answered} of ${q.of} questions answered — ${first}.`;
}
