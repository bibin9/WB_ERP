import { getSession } from "@/lib/auth";
import { visibleScreens } from "@/lib/rbac";
import ModuleTabsClient from "./ModuleTabsClient";
import { DASHBOARD } from "@/lib/moduletabs";

/** Server wrapper: filters the HR sub-tabs to the screens this user may view. */
export default async function HrTabs() {
  const session = await getSession();
  const screens = visibleScreens(session, "hr");
  const allowed = screens.length ? [DASHBOARD, ...screens] : screens;
  return <ModuleTabsClient module="hr" allowed={allowed} />;
}
