import { getSession } from "@/lib/auth";
import { visibleScreens } from "@/lib/rbac";
import ModuleTabsClient from "./ModuleTabsClient";
import { DASHBOARD } from "@/lib/moduletabs";

/** Server wrapper: filters the stores tabs to the screens this user may view. */
export default async function InventoryTabs() {
  const session = await getSession();
  const screens = visibleScreens(session, "inventory");
  const allowed = screens.length ? [DASHBOARD, ...screens] : screens;
  return <ModuleTabsClient module="inventory" allowed={allowed} />;
}
