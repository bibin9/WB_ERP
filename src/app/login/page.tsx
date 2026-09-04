import { activeTenant } from "@/config/tenant";
import LoginForm from "@/components/LoginForm";

export default function LoginPage() {
  const t = activeTenant;
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* Brand panel */}
      <div className="relative hidden flex-col justify-between bg-brand-navy p-10 text-white lg:flex">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={t.logoWhite} alt={t.productName} className="h-12 w-auto max-w-[220px] self-start object-contain" />
        <div>
          <h1 className="text-3xl font-bold leading-tight">
            Precision Engineering,
            <br /> Powering Efficiency.
          </h1>
          <p className="mt-3 max-w-sm text-white/70">
            One connected platform for the whole group — Finance, Inventory, CRM, Projects,
            HSE and HR.
          </p>
        </div>
        <div className="text-xs text-white/50">Confidential · {t.appName}</div>
        <div className="pointer-events-none absolute -right-16 top-1/3 h-64 w-64 rounded-full bg-brand-blue/20 blur-3xl" />
      </div>

      {/* Form */}
      <div className="flex items-center justify-center bg-brand-paper p-8">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={t.logo} alt={t.productName} className="h-12 w-auto max-w-[220px] object-contain" />
          </div>
          <h2 className="text-2xl font-bold text-heading">Sign in</h2>
          <p className="mt-1 text-sm text-muted">Welcome back. Please enter your details.</p>

          <LoginForm />

          <p className="mt-6 rounded-lg bg-brand-blue/5 px-3 py-2 text-center text-xs text-muted">
            Demo login is pre-filled: <span className="font-medium text-ink">admin@wandb.ae / admin123</span>
          </p>
        </div>
      </div>
    </div>
  );
}
