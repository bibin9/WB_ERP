import Link from "next/link";
import { Bell, Search } from "lucide-react";
import CompanySwitcher from "./CompanySwitcher";
import NavToggle from "./NavToggle";
import ThemeToggle from "./ThemeToggle";
import UserMenu from "./UserMenu";
import HelpLauncher from "./help/HelpLauncher";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";

export default async function Topbar() {
  const session = await getSession();
  const name = session?.user.name ?? "User";
  const role = session?.companies[0]?.role ?? "Member";
  const unread = session ? await db.notification.count({ where: { userId: session.user.id, isRead: false } }) : 0;

  return (
    <header className="flex h-16 shrink-0 items-center gap-3 border-b border-line bg-surface px-4 sm:gap-4 sm:px-6">
      <NavToggle />
      <CompanySwitcher companies={(session?.companies ?? []).map((c) => ({ id: c.id, code: c.code, name: c.name }))} />

      <div className="relative ml-2 hidden max-w-sm flex-1 md:block">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
        <input className="input pl-9" placeholder="Search (Ctrl + K) — coming soon" disabled />
      </div>

      <div className="ml-auto flex items-center gap-3">
        <ThemeToggle />
        <HelpLauncher />
        <Link href="/notifications" className="relative grid h-9 w-9 place-items-center rounded-lg text-muted hover:bg-line/60" title="Notifications">
          <Bell className="h-5 w-5" />
          {unread > 0 && (
            <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-brand-green px-1 text-[10px] font-bold text-white">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </Link>
        <UserMenu name={name} email={session?.user.email ?? ""} role={role} />
      </div>
    </header>
  );
}
