"use client";

import { useActionState } from "react";
import { AlertCircle, KeyRound } from "lucide-react";
import { changePassword } from "@/app/(app)/account/actions";

export default function ChangePasswordForm() {
  const [error, formAction, pending] = useActionState(changePassword, undefined);

  return (
    <form action={formAction} className="max-w-md space-y-4">
      {error && (
        <div className="flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          <AlertCircle className="h-4 w-4 shrink-0" /> {error}
        </div>
      )}
      <div>
        <label className="mb-1.5 block text-sm font-medium text-ink">Current password</label>
        <input name="current" type="password" className="input" placeholder="••••••••" autoComplete="current-password" required />
      </div>
      <div>
        <label className="mb-1.5 block text-sm font-medium text-ink">New password</label>
        <input name="next" type="password" className="input" placeholder="At least 6 characters" autoComplete="new-password" required />
      </div>
      <div>
        <label className="mb-1.5 block text-sm font-medium text-ink">Confirm new password</label>
        <input name="confirm" type="password" className="input" placeholder="Re-type new password" autoComplete="new-password" required />
      </div>
      <button type="submit" disabled={pending} className="btn-primary disabled:opacity-60">
        <KeyRound className="h-4 w-4" /> {pending ? "Updating…" : "Update password"}
      </button>
    </form>
  );
}
