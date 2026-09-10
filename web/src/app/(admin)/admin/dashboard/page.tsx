"use client";

import { useCurrentUser } from "@/lib/auth/AuthProvider";
import { Card } from "@/components/ui/Card";

// Placeholder: proves the route guard + profile read work. Real admin
// features (provisioning UI, stats view, etc.) land in their own milestones.
export default function AdminDashboardPage() {
  const { uid, profile } = useCurrentUser();
  return (
    <main className="mx-auto max-w-3xl p-8">
      <h1 className="text-xl font-semibold text-brand-primary">Admin Dashboard (placeholder)</h1>
      <Card className="mt-4">
        <p className="font-mono text-sm">uid: {uid}</p>
        <pre className="mt-2 text-sm">{JSON.stringify(profile, null, 2)}</pre>
      </Card>
    </main>
  );
}
