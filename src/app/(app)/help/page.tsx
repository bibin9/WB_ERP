import { LifeBuoy } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import HelpCenter from "@/components/help/HelpCenter";

export const dynamic = "force-dynamic";

export default function HelpPage() {
  return (
    <div>
      <PageHeader title="Help Center" subtitle="Step-by-step guides in plain English. Search, or browse by area." />
      <div className="mb-5 flex items-start gap-3 rounded-lg bg-brand-blue/5 p-4 text-sm text-muted">
        <LifeBuoy className="mt-0.5 h-5 w-5 shrink-0 text-brand-blue-600" />
        <p>New to the system? Start with <span className="font-medium text-ink">Getting Started</span> below. On any screen you can also click the <span className="font-medium text-ink">“?”</span> in the top bar for help about that exact page.</p>
      </div>
      <HelpCenter />
    </div>
  );
}
