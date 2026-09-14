import { getSession } from "@/lib/auth";
import { visibleScreens } from "@/lib/rbac";
import ModuleTabsClient from "./ModuleTabsClient";

/** Server wrapper: filters the stores tabs to the screens this user may view. */
export default async function InventoryTabs() {
  const session = await getSession();
  const allowed = visibleScreens(session, "inventory");
  return <ModuleTabsClient module="inventory" allowed={allowed} />;
}
