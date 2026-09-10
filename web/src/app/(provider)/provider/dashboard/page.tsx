"use client";

import Link from "next/link";
import { useCurrentUser } from "@/lib/auth/AuthProvider";
import { Card } from "@/components/ui/Card";

export default function ProviderDashboardPage() {
  const { profile } = useCurrentUser();
  const name = (profile?.name as string) ?? "there";
  const providerId = profile?.providerId as string | undefined;
  const homeBuildingId = profile?.homeBuildingId as string | undefined;

  return (
    <main className="mx-auto max-w-3xl p-8">
      <h1 className="text-xl font-semibold text-brand-primary">Welcome, {name}</h1>
      <p className="mt-1 text-sm text-brand-primary/70">
        {[providerId, homeBuildingId].filter(Boolean).join(" · ") || "Provider staff"}
      </p>
      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Card>
          <h2 className="font-semibold text-brand-primary">Ticket Queue</h2>
          <p className="mt-1 text-sm text-brand-primary/70">
            Acknowledge, pause, resume, and resolve tickets for your building.
          </p>
          <Link href="/provider/queue" className="mt-3 inline-block text-sm font-semibold text-brand-info">
            View queue →
          </Link>
        </Card>
        <Card>
          <h2 className="font-semibold text-brand-primary">Monthly Reports</h2>
          <p className="mt-1 text-sm text-brand-primary/70">
            Review past performance snapshots for your provider.
          </p>
          <Link href="/provider/reports" className="mt-3 inline-block text-sm font-semibold text-brand-info">
            View reports →
          </Link>
        </Card>
      </div>
    </main>
  );
}
