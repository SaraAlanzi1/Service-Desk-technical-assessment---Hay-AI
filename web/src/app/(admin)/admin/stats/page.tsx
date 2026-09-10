"use client";

import { useEffect, useState } from "react";
import { collection, getDocs, query, where, type Timestamp } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import {
  averageResolveTimeMinutes,
  currentClockState,
  type PauseInterval,
  type Ticket,
} from "@hay-service-desk/shared";
import { Card } from "@/components/ui/Card";
import { LoadingState } from "@/components/ui/LoadingState";

const PROVIDERS = [
  { id: "provider-cleaning", name: "Cleaning" },
  { id: "provider-maintenance", name: "Maintenance" },
];

interface ProviderStats {
  providerId: string;
  name: string;
  openCount: number;
  breachedCount: number;
  avgResolveTimeMinutes: number;
}

// Live-computed from current Firestore state on every page load — not the
// persisted MonthlyReport snapshot, which is a separate admin-triggered
// action (see /admin/reports).
export default function AdminStatsPage() {
  const [stats, setStats] = useState<ProviderStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const results: ProviderStats[] = [];
        for (const provider of PROVIDERS) {
          const snap = await getDocs(query(collection(db, "Ticket"), where("providerId", "==", provider.id)));
          let openCount = 0;
          let breachedCount = 0;
          const resolveEntries: Array<{ acknowledgedAtMs: number; pauses: PauseInterval[]; resolvedAtMs: number }> = [];

          for (const d of snap.docs) {
            const ticket = d.data() as Ticket;
            if (ticket.workflowStatus !== "resolved") openCount++;

            // Resolved tickets always have a reliable firstBreachedAt: both
            // clocks only ever get checked at acknowledge() and
            // resolveTicket() respectively, and resolveTicket() must have
            // run for the ticket to be resolved at all — so resolution
            // itself is the final, guaranteed check. No sweep gap applies
            // here; trusting the stored field is correct.
            //
            // Non-resolved tickets (submitted/acknowledged/paused) are
            // exactly where the sweep gap lives: a ticket can sit past its
            // deadline with no transition ever called on it, leaving
            // firstBreachedAt unset even though it's factually breached.
            // currentClockState() already respects an existing
            // firstBreachedAt (via the "breach once, breach forever" check)
            // and otherwise live-computes from raw timestamps, so calling
            // it here — rather than trusting the stored field alone —
            // fixes the undercount without needing a scheduled sweep.
            if (ticket.workflowStatus === "resolved") {
              if (ticket.firstBreachedAt) breachedCount++;
            } else {
              const pausesSnap = await getDocs(collection(db, "Ticket", d.id, "PauseWindow"));
              const pauses: PauseInterval[] = pausesSnap.docs.map((p) => {
                const data = p.data();
                const pausedAt = data.pausedAt as Timestamp;
                const resumedAt = data.resumedAt as Timestamp | null;
                return {
                  pausedAtMs: pausedAt.toMillis(),
                  resumedAtMs: resumedAt ? resumedAt.toMillis() : null,
                };
              });
              const clockState = currentClockState(
                {
                  workflowStatus: ticket.workflowStatus,
                  submittedAtMs: ticket.submittedAt.toMillis(),
                  acknowledgedAtMs: ticket.acknowledgedAt ? ticket.acknowledgedAt.toMillis() : null,
                  firstBreachedAt: ticket.firstBreachedAt
                    ? {
                        timestampMs: ticket.firstBreachedAt.timestamp.toMillis(),
                        clock: ticket.firstBreachedAt.clock,
                      }
                    : null,
                },
                pauses,
                Date.now(),
              );
              if (clockState?.breached) breachedCount++;
            }

            if (ticket.workflowStatus === "resolved" && ticket.acknowledgedAt && ticket.resolvedAt) {
              const pausesSnap = await getDocs(collection(db, "Ticket", d.id, "PauseWindow"));
              const resolvedAtMs = ticket.resolvedAt.toMillis();
              const pauses: PauseInterval[] = pausesSnap.docs.map((p) => {
                const data = p.data();
                const pausedAt = data.pausedAt as Timestamp;
                const resumedAt = data.resumedAt as Timestamp | null;
                return {
                  pausedAtMs: pausedAt.toMillis(),
                  resumedAtMs: resumedAt ? resumedAt.toMillis() : resolvedAtMs,
                };
              });
              resolveEntries.push({
                acknowledgedAtMs: ticket.acknowledgedAt.toMillis(),
                pauses,
                resolvedAtMs,
              });
            }
          }

          results.push({
            providerId: provider.id,
            name: provider.name,
            openCount,
            breachedCount,
            avgResolveTimeMinutes: averageResolveTimeMinutes(resolveEntries),
          });
        }
        setStats(results);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  if (loading) return <LoadingState label="Loading stats…" />;

  return (
    <main className="mx-auto max-w-3xl p-8">
      <h1 className="text-xl font-semibold text-brand-primary">Provider Stats</h1>
      {error && <p className="mt-3 text-sm text-brand-error">{error}</p>}
      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {stats.map((s) => (
          <Card key={s.providerId}>
            <h2 className="font-semibold text-brand-primary">{s.name}</h2>
            <dl className="mt-3 space-y-1.5 text-sm">
              <div className="flex items-center justify-between">
                <dt className="text-brand-primary/60">Open tickets</dt>
                <dd className="font-semibold">{s.openCount}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-brand-primary/60">Breached tickets</dt>
                <dd className={`font-semibold ${s.breachedCount > 0 ? "text-brand-error" : ""}`}>
                  {s.breachedCount}
                </dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-brand-primary/60">Avg resolve time</dt>
                <dd className="font-semibold">{s.avgResolveTimeMinutes.toFixed(1)} min</dd>
              </div>
            </dl>
          </Card>
        ))}
      </div>
    </main>
  );
}
