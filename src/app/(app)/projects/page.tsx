import ComingSoon from "@/components/ComingSoon";
import { requireAccess } from "@/lib/guard";

export default async function Page() {
  await requireAccess("projects.list");
  return <ComingSoon title="Projects" phase={3} />;
}
