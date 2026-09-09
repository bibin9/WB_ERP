import { getSession } from "@/lib/auth";
import { visibleScreens } from "@/lib/rbac";
import ModuleTabsClient from "./ModuleTabsClient";

/** Server wrapper: filters the finance sub-tabs to the screens this user may view. */
export default async function FinanceTabs({ companyId }: { companyId: string }) {
  const session = await getSession();
  const allowed = visibleScreens(session, "finance");
  return <ModuleTabsClient module="finance" companyId={companyId} allowed={allowed} />;
}
