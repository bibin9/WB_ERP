"use client";

import { useActionState } from "react";
import { AlertCircle } from "lucide-react";
import { login } from "@/app/login/actions";

/**
 * The demo credentials belong to a demo, and only to a demo.
 *
 * They used to be pre-filled into the fields and printed under them, on every
 * deployment including the live one — so anybody who found the URL was one
 * click from being a Group Admin with every salary, passport and IBAN in the
 * system. NEXT_PUBLIC_DEMO_LOGIN has to be set deliberately, and is not set in
 * production, so the default everywhere is to fill in nothing.
 */
const DEMO = process.env.NEXT_PUBLIC_DEMO_LOGIN === "1";

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
        <input
          name="email"
          type="email"
          className="input"
          placeholder="you@company.com"
          defaultValue={DEMO ? "admin@wandb.ae" : ""}
          autoComplete="username"
          required
        />
      </div>
      <div>
        <label className="mb-1.5 block text-sm font-medium text-ink">Password</label>
        <input
          name="password"
          type="password"
          className="input"
          placeholder="••••••••"
          defaultValue={DEMO ? "admin123" : ""}
          autoComplete="current-password"
          required
        />
      </div>
      <button type="submit" disabled={pending} className="btn-primary w-full disabled:opacity-60">
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
