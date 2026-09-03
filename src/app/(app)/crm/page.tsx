import ComingSoon from "@/components/ComingSoon";
import { requireAccess } from "@/lib/guard";

export default async function Page() {
  await requireAccess("crm.leads");
  return <ComingSoon title="CRM & Estimation" phase={2} />;
}
