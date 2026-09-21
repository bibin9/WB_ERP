import Sidebar from "@/components/Sidebar";
import Topbar from "@/components/Topbar";
import ForcePasswordChange from "@/components/ForcePasswordChange";
import { getSession } from "@/lib/auth";
import { visibleModules, visibleScreens } from "@/lib/rbac";
import { redirect } from "next/navigation";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  // A signed cookie whose session has ended (lib/auth.ts): clear it and sign in again.
  if (!session) redirect("/api/session-ended");
  // The screens this person may open, plus each module with any of them — a
  // module's sidebar entry opens its dashboard (lib/data.ts).
  const screens = visibleScreens(session);
  const allowedScreens = [...screens, ...visibleModules(session)];
  return (
    <div className="flex h-screen overflow-hidden">
      <ForcePasswordChange active={session?.user.mustReset ?? false} />
      <Sidebar allowedScreens={allowedScreens} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        <main className="flex-1 overflow-y-auto bg-brand-paper p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
