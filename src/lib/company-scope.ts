/**
 * Which companies a group-wide screen shows: all the ones you belong to, or
 * the one picked in its company filter.
 *
 * People, Approvals, Overtime and the other group-wide screens listed every
 * company's records together with no way to narrow them — reported from use
 * on the People list. Their filter offers "All companies" as well as each one,
 * and this turns the choice (?c= in the address) into the ids to query.
 *
 * It only ever narrows: a company id you do not belong to is ignored and you
 * see your own companies, never someone else's.
 */
export function companyScope(
  accessible: { id: string }[],
  picked: string | undefined,
): { ids: string[]; current: string } {
  const one = accessible.find((c) => c.id === picked);
  return one ? { ids: [one.id], current: one.id } : { ids: accessible.map((c) => c.id), current: ALL_COMPANIES };
}

/** The filter's value for "every company you belong to". */
export const ALL_COMPANIES = "all";
