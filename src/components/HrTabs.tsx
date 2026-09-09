import { getSession } from "@/lib/auth";
import { visibleScreens } from "@/lib/rbac";
import ModuleTabsClient from "./ModuleTabsClient";

/** Server wrapper: filters the HR sub-tabs to the screens this user may view. */
export default async function HrTabs() {
  const session = await getSession();
  const allowed = visibleScreens(session, "hr");
  return <ModuleTabsClient module="hr" allowed={allowed} />;
}
