/**
 * The vocabulary of costing, shared by the server actions and the forms.
 *
 * A job and a project are one record in this system. Both ERPNext and Odoo
 * arrive at the same place from different directions — ERPNext makes Project
 * itself the costing dimension, Odoo links a project to an analytic account —
 * and for a contractor there is no project that is not a job. `type` is the
 * word the client uses, not a different thing: everything below is costed
 * identically, and a second table would only be two sets of costing to keep in
 * step.
 *
 * Not server-only: the forms need this list too.
 */

export const JOB_TYPES = ["Contract", "Project", "Service call", "AMC", "Internal"] as const;

export type JobType = (typeof JOB_TYPES)[number];

/** Shown under the picker, so the choice needs no finance background. */
export const JOB_TYPE_HELP: Record<string, string> = {
  Contract: "A priced piece of work for a customer — the usual case.",
  Project: "The same thing, when the customer's paperwork calls it a project.",
  "Service call": "A one-off visit or small repair.",
  AMC: "An annual maintenance contract, billed over the year.",
  Internal: "Our own work, with no customer paying for it.",
};

export const JOB_STATUSES = ["Open", "On hold", "Completed", "Closed"] as const;

/**
 * Encoding which dimension a voucher line was charged to.
 *
 * A line carries a job or a cost centre, never both, so the form offers one
 * list rather than two and tags each option with which kind it is. Keeping the
 * pair here — rather than inside the component — means the round trip can be
 * tested, and the rule cannot be broken by editing one half of it.
 */
export const chargeValue = (l: { jobId?: string | null; costCentreId?: string | null }) =>
  l.jobId ? `job:${l.jobId}` : l.costCentreId ? `cc:${l.costCentreId}` : "";

export const chargeFrom = (value: string) => ({
  jobId: value.startsWith("job:") ? value.slice("job:".length) : "",
  costCentreId: value.startsWith("cc:") ? value.slice("cc:".length) : "",
});
