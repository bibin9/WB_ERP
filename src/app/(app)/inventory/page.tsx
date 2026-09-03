import ComingSoon from "@/components/ComingSoon";
import { requireAccess } from "@/lib/guard";

export default async function Page() {
  await requireAccess("inventory.items");
  return <ComingSoon title="Inventory & SCM" phase={2} />;
}
