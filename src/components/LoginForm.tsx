"use client";

import { useActionState } from "react";
import { AlertCircle } from "lucide-react";
import { login } from "@/app/login/actions";

export default function LoginForm() {
  const [error, formAction, pending] = useActionState(login, undefined);

  return (
    <form action={formAction} className="mt-8 space-y-4">
      {error && (
        <div className="flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          <AlertCircle className="h-4 w-4 shrink-0" /> {error}
        </div>
      )}
      <div>
        <label className="mb-1.5 block text-sm font-medium text-ink">Email</label>
        <input name="email" type="email" className="input" placeholder="you@company.com" defaultValue="admin@wandb.ae" required />
      </div>
      <div>
        <label className="mb-1.5 block text-sm font-medium text-ink">Password</label>
        <input name="password" type="password" className="input" placeholder="••••••••" defaultValue="admin@123" required />
      </div>
      <button type="submit" disabled={pending} className="btn-primary w-full disabled:opacity-60">
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
