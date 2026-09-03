"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { CheckCheck, ClipboardCheck, Bell } from "lucide-react";
import { markRead } from "@/app/(app)/notifications/actions";

type N = { id: string; type: string; title: string; body: string | null; link: string | null; isRead: boolean; createdAt: string };

export default function NotificationItem({ n }: { n: N }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const Icon = n.type === "approval" ? ClipboardCheck : Bell;

  function open() {
    start(async () => {
      await markRead(n.id);
      if (n.link) router.push(n.link);
    });
  }

  return (
    <button
      onClick={open}
      disabled={pending}
      className={clsx("flex w-full items-start gap-3 px-5 py-3.5 text-left hover:bg-brand-paper", !n.isRead && "bg-brand-blue/5")}
    >
      <span className={clsx("mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg", n.type === "approval" ? "bg-brand-gold/15 text-brand-gold" : "bg-brand-blue/10 text-brand-blue-600")}>
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className={clsx("text-sm", n.isRead ? "text-ink" : "font-medium text-ink")}>{n.title}</div>
        {n.body && <div className="text-xs text-muted">{n.body}</div>}
        <div className="mt-0.5 text-[11px] text-muted/70">{new Date(n.createdAt).toLocaleString("en-GB")}</div>
      </div>
      {!n.isRead && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand-green" />}
    </button>
  );
}

export function MarkAllButton({ action }: { action: () => Promise<void> }) {
  const [pending, start] = useTransition();
  return (
    <button onClick={() => start(() => action())} disabled={pending} className="btn-ghost border border-line">
      <CheckCheck className="h-4 w-4" /> Mark all read
    </button>
  );
}
