import ComingSoon from "@/components/ComingSoon";
import { requireAccess } from "@/lib/guard";

export default async function Page() {
  await requireAccess("hse.register");
  return <ComingSoon title="Health, Safety & Environment (HSE)" phase={3} />;
}
