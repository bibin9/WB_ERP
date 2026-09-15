import { getSession } from "@/lib/auth";
import { visibleScreens } from "@/lib/rbac";
import ModuleTabsClient from "./ModuleTabsClient";

/** Server wrapper: filters the CRM tabs to the screens this user may view. */
export default async function CrmTabs() {
  const session = await getSession();
  const allowed = visibleScreens(session, "crm");
  return <ModuleTabsClient module="crm" allowed={allowed} />;
}
