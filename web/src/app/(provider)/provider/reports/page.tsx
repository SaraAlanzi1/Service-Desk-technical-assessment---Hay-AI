"use client";

import { useEffect, useState } from "react";
import { collection, onSnapshot, orderBy, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { useCurrentUser } from "@/lib/auth/AuthProvider";
import type { MonthlyReport } from "@hay-service-desk/shared";
import { Card } from "@/components/ui/Card";

interface ReportRow {
  id: string;
  data: MonthlyReport;
}

// Read-only — provider staff cannot generate reports, only view their own
// provider's history.
export default function ProviderReportsPage() {
  const { profile } = useCurrentUser();
  const [reports, setReports] = useState<ReportRow[]>([]);

  useEffect(() => {
    if (!profile) return;
    const providerId = profile.providerId as string;
    // Constrained by providerId to match the rule's own scope check — an
    // unconstrained query would be denied for a non-admin reader.
    const q = query(
      collection(db, "MonthlyReport"),
      where("providerId", "==", providerId),
      orderBy("generatedAt", "desc"),
    );
    const unsub = onSnapshot(q, (snap) => {
      setReports(snap.docs.map((d) => ({ id: d.id, data: d.data() as MonthlyReport })));
    });
    return unsub;
  }, [profile]);

  return (
    <main className="mx-auto max-w-3xl p-8">
      <h1 className="text-xl font-semibold text-brand-primary">Monthly Reports</h1>
      <Card className="mt-4">
        {reports.length === 0 ? (
          <p className="py-6 text-center text-sm text-brand-primary/50">No reports yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-brand-border text-brand-primary/70">
                  <th className="py-2 font-semibold">Period</th>
                  <th className="py-2 font-semibold">Total</th>
                  <th className="py-2 font-semibold">Open</th>
                  <th className="py-2 font-semibold">Breached</th>
                  <th className="py-2 font-semibold">Avg Resolve (min)</th>
                </tr>
              </thead>
              <tbody>
                {reports.map((r) => (
                  <tr key={r.id} className="border-b border-brand-border transition-colors hover:bg-brand-cream/60">
                    <td className="py-2.5 font-medium">
                      {r.data.month}/{r.data.year}
                    </td>
                    <td className="py-2.5">{r.data.totalTickets}</td>
                    <td className="py-2.5">{r.data.openCount}</td>
                    <td className="py-2.5">
                      {r.data.breachedCount > 0 ? (
                        <span className="font-semibold text-brand-error">{r.data.breachedCount}</span>
                      ) : (
                        r.data.breachedCount
                      )}
                    </td>
                    <td className="py-2.5">{r.data.avgResolveTimeMinutes.toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </main>
  );
}
