"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, orderBy, query, where, type Timestamp } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { useCurrentUser } from "@/lib/auth/AuthProvider";
import { currentClockState, type PauseInterval, type Ticket } from "@hay-service-desk/shared";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { slaUrgency } from "@/components/ui/slaUrgency";

function formatDuration(ms: number): string {
  const sign = ms < 0 ? "-" : "";
  const abs = Math.abs(ms);
  const hours = Math.floor(abs / (60 * 60 * 1000));
  const minutes = Math.floor((abs % (60 * 60 * 1000)) / (60 * 1000));
  return `${sign}${hours}h ${minutes}m`;
}

interface TicketRow {
  id: string;
  data: Ticket;
}

function TenantTicketRow({ row, nowMs }: { row: TicketRow; nowMs: number }) {
  const [pauses, setPauses] = useState<PauseInterval[]>([]);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, "Ticket", row.id, "PauseWindow"), (snap) => {
      setPauses(
        snap.docs.map((d) => {
          const data = d.data();
          const pausedAt = data.pausedAt as Timestamp;
          const resumedAt = data.resumedAt as Timestamp | null;
          return { pausedAtMs: pausedAt.toMillis(), resumedAtMs: resumedAt ? resumedAt.toMillis() : null };
        }),
      );
    });
    return unsub;
  }, [row.id]);

  const clockState = useMemo(() => {
    return currentClockState(
      {
        workflowStatus: row.data.workflowStatus,
        submittedAtMs: row.data.submittedAt.toMillis(),
        acknowledgedAtMs: row.data.acknowledgedAt ? row.data.acknowledgedAt.toMillis() : null,
        firstBreachedAt: row.data.firstBreachedAt
          ? {
              timestampMs: row.data.firstBreachedAt.timestamp.toMillis(),
              clock: row.data.firstBreachedAt.clock,
            }
          : null,
      },
      pauses,
      nowMs,
    );
  }, [row.data, pauses, nowMs]);

  return (
    <tr className="border-b border-brand-border">
      <td className="py-2">{row.data.title}</td>
      <td className="py-2">{row.data.category}</td>
      <td className="py-2">{row.data.priority}</td>
      <td className="py-2">{row.data.workflowStatus}</td>
      <td className="py-2">
        {clockState ? (
          <Badge variant={slaUrgency(clockState)}>
            {clockState.breached
              ? `BREACHED by ${formatDuration(clockState.elapsedMs - clockState.limitMs)}`
              : `${formatDuration(clockState.limitMs - clockState.elapsedMs)} left`}
          </Badge>
        ) : (
          "—"
        )}
      </td>
    </tr>
  );
}

export default function TenantTicketsPage() {
  const { uid } = useCurrentUser();
  const [rows, setRows] = useState<TicketRow[]>([]);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const interval = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!uid) return;
    const q = query(collection(db, "Ticket"), where("tenantId", "==", uid), orderBy("submittedAt", "desc"));
    const unsub = onSnapshot(q, (snap) => {
      setRows(snap.docs.map((d) => ({ id: d.id, data: d.data() as Ticket })));
    });
    return unsub;
  }, [uid]);

  return (
    <main className="mx-auto max-w-3xl p-8">
      <h1 className="text-xl font-semibold text-brand-primary">My Tickets</h1>
      <Card className="mt-4">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-brand-border">
              <th className="py-2">Title</th>
              <th className="py-2">Category</th>
              <th className="py-2">Priority</th>
              <th className="py-2">Status</th>
              <th className="py-2">SLA</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <TenantTicketRow key={row.id} row={row} nowMs={nowMs} />
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <p className="text-sm text-brand-primary/60">No tickets yet.</p>}
      </Card>
    </main>
  );
}
