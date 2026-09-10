"use client";

import Link from "next/link";
import { useCurrentUser } from "@/lib/auth/AuthProvider";
import { Card } from "@/components/ui/Card";

export default function TenantDashboardPage() {
  const { profile } = useCurrentUser();
  const name = (profile?.name as string) ?? "there";
  const unit = profile?.unit as string | undefined;
  const buildingId = profile?.buildingId as string | undefined;

  return (
    <main className="mx-auto max-w-3xl p-8">
      <h1 className="text-xl font-semibold text-brand-primary">Welcome, {name}</h1>
      <p className="mt-1 text-sm text-brand-primary/70">
        {buildingId ? `${buildingId}${unit ? ` · Unit ${unit}` : ""}` : "Tenant"}
      </p>
      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Link href="/tenant/tickets" className="block">
          <Card className="h-full transition-shadow hover:shadow-md">
            <h2 className="font-semibold text-brand-primary">My Tickets</h2>
            <p className="mt-1 text-sm text-brand-primary/70">
              View the status and SLA countdown for every ticket you&apos;ve submitted.
            </p>
            <span className="mt-3 inline-block text-sm font-semibold text-brand-info">View tickets →</span>
          </Card>
        </Link>
        <Link href="/tenant/tickets/new" className="block">
          <Card className="h-full transition-shadow hover:shadow-md">
            <h2 className="font-semibold text-brand-primary">New Ticket</h2>
            <p className="mt-1 text-sm text-brand-primary/70">
              Report a cleaning or maintenance issue for your unit.
            </p>
            <span className="mt-3 inline-block text-sm font-semibold text-brand-info">Submit a ticket →</span>
          </Card>
        </Link>
      </div>
    </main>
  );
}
