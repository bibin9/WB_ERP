import Sidebar from "@/components/Sidebar";
import Topbar from "@/components/Topbar";
import ForcePasswordChange from "@/components/ForcePasswordChange";
import { getSession } from "@/lib/auth";
import { visibleScreens } from "@/lib/rbac";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  const allowedScreens = visibleScreens(session);
  return (
    <div className="flex h-screen overflow-hidden">
      <ForcePasswordChange active={session?.user.mustReset ?? false} />
      <Sidebar allowedScreens={allowedScreens} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        <main className="flex-1 overflow-y-auto bg-brand-paper p-6">{children}</main>
      </div>
    </div>
  );
}
