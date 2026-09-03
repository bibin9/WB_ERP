import { getSession } from "@/lib/auth";
import { visibleScreens } from "@/lib/rbac";
import FinanceTabsClient from "./FinanceTabsClient";

/** Server wrapper: filters the finance sub-tabs to the screens this user may view. */
export default async function FinanceTabs({ companyId }: { companyId: string }) {
  const session = await getSession();
  const allowed = visibleScreens(session, "finance");
  return <FinanceTabsClient companyId={companyId} allowed={allowed} />;
}
