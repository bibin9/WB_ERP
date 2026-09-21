import { getSession } from "@/lib/auth";
import { visibleScreens } from "@/lib/rbac";
import ModuleTabsClient from "./ModuleTabsClient";
import { DASHBOARD } from "@/lib/moduletabs";

/** Server wrapper: filters the CRM tabs to the screens this user may view. */
export default async function CrmTabs() {
  const session = await getSession();
  const screens = visibleScreens(session, "crm");
  const allowed = screens.length ? [DASHBOARD, ...screens] : screens;
  return <ModuleTabsClient module="crm" allowed={allowed} />;
}
