import { getSession } from "@/lib/auth";
import { visibleScreens } from "@/lib/rbac";
import ModuleTabsClient from "./ModuleTabsClient";
import { DASHBOARD } from "@/lib/moduletabs";

/** Server wrapper: filters the finance sub-tabs to the screens this user may view. */
export default async function FinanceTabs({ companyId }: { companyId: string }) {
  const session = await getSession();
  const screens = visibleScreens(session, "finance");
  const allowed = screens.length ? [DASHBOARD, ...screens] : screens;
  return <ModuleTabsClient module="finance" companyId={companyId} allowed={allowed} />;
}
