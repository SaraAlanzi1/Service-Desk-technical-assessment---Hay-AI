"use client";

import Link from "next/link";
import { useCurrentUser } from "@/lib/auth/AuthProvider";
import { Card } from "@/components/ui/Card";

export default function AdminDashboardPage() {
  const { profile } = useCurrentUser();
  const name = (profile?.name as string) ?? "there";

  return (
    <main className="mx-auto max-w-3xl p-8">
      <h1 className="text-xl font-semibold text-brand-primary">Welcome, {name}</h1>
      <p className="mt-1 text-sm text-brand-primary/70">Operator Admin</p>
      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Link href="/admin/reports" className="block">
          <Card className="h-full transition-shadow hover:shadow-md">
            <h2 className="font-semibold text-brand-primary">Monthly Reports</h2>
            <p className="mt-1 text-sm text-brand-primary/70">
              Generate and review monthly SLA performance snapshots by provider.
            </p>
            <span className="mt-3 inline-block text-sm font-semibold text-brand-info">View reports →</span>
          </Card>
        </Link>
        <Link href="/admin/stats" className="block">
          <Card className="h-full transition-shadow hover:shadow-md">
            <h2 className="font-semibold text-brand-primary">Provider Stats</h2>
            <p className="mt-1 text-sm text-brand-primary/70">
              Live open-ticket and breach counts across both providers.
            </p>
            <span className="mt-3 inline-block text-sm font-semibold text-brand-info">View stats →</span>
          </Card>
        </Link>
      </div>
    </main>
  );
}
