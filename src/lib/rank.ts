/**
 * Who may manage whom.
 *
 * User and role management used to ask one question — "is this person an
 * administrator (level 80 or above)?" — and nothing about the person or role
 * being changed. So a Director could reset the Group Admin's password and be
 * handed the temporary one, give themselves the Group Admin role, create a
 * role above everybody, or lock the Group Admin out. One stolen Director
 * password was the whole group's books.
 *
 * The rule now: you manage people and roles below your own level. The top
 * level (the Group Admin) manages everything up to and including itself,
 * because somebody has to be able to look after the top.
 *
 * Pure, so it is tested directly (scripts/test-rank.mjs).
 */

/** The Group Admin's level. Nothing sits above it. */
export const TOP_LEVEL = 100;

/** A person's level: the highest role they hold in any company. -1 for none. */
export const levelOf = (levels: number[]): number => (levels.length ? Math.max(...levels) : -1);

/** Whether someone at `actor` may manage a person, or a role, at `target`. */
export function outranks(actor: number, target: number): boolean {
  if (actor >= TOP_LEVEL) return target <= TOP_LEVEL;
  return target < actor;
}

/** A role level somebody typed, made safe: a whole number from 0 to the top. */
export function cleanLevel(raw: unknown): number | null {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > TOP_LEVEL) return null;
  return n;
}

/** What the screen says when the rule refuses. */
export const OUTRANKED = "You can only manage people and roles below your own level. Ask someone more senior.";
