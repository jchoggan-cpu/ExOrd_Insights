import { Suspense } from "react";
import { GateForm } from "@/components/gate-form";

export default function GatePage() {
  return (
    <main className="flex flex-1 items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm rounded-lg border border-border bg-surface p-6">
        <h1 className="font-display text-xl font-semibold text-foreground">Executive Actions Tracker</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          This internal tool is password-protected while it&apos;s still a prototype. Enter
          the shared password to continue.
        </p>
        <Suspense>
          <GateForm />
        </Suspense>
      </div>
    </main>
  );
}
