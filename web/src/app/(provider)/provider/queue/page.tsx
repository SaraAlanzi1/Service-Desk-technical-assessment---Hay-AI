"use client";

import { useEffect, useMemo, useState } from "react";
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
  where,
  type Timestamp,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "@/lib/firebase/client";
import { useCurrentUser } from "@/lib/auth/AuthProvider";
import {
  currentClockState,
  type PauseInterval,
  type Ticket,
  type TicketWorkflowStatus,
} from "@hay-service-desk/shared";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { slaUrgency } from "@/components/ui/slaUrgency";

function formatDuration(ms: number): string {
  const sign = ms < 0 ? "-" : "";
  const abs = Math.abs(ms);
  const hours = Math.floor(abs / (60 * 60 * 1000));
  const minutes = Math.floor((abs % (60 * 60 * 1000)) / (60 * 1000));
  return `${sign}${hours}h ${minutes}m`;
}

// requestedBy is a ProviderStaff uid. Firestore rules (locked in Milestone
// 1) only let a staff member read their own profile, not a colleague's — so
// there's no name to resolve here for anyone but yourself. Showing a
// truncated uid instead of a name is a known limitation, not an oversight;
// resolving it means either broadening ProviderStaff read access beyond
// what M1 locked in, or denormalizing a name onto PauseWindow (a field not
// in §2's schema). Neither call is mine to make silently.
function formatUid(uid: string): string {
  return uid.slice(0, 8);
}

interface TicketRow {
  id: string;
  data: Ticket;
}

interface PauseDoc {
  id: string;
  pausedAtMs: number;
  resumedAtMs: number | null;
  reason: string;
  requestedBy: string;
  estimatedResumeAtMs: number;
  statusNote: string | null;
}

function TicketRow({
  row,
  nowMs,
  onAcknowledge,
  onOpenPause,
  onResume,
  onResolve,
}: {
  row: TicketRow;
  nowMs: number;
  onAcknowledge: (ticketId: string) => void;
  onOpenPause: (ticketId: string, reason: string, estimatedResumeAt: string) => void;
  onResume: (ticketId: string) => void;
  onResolve: (ticketId: string) => void;
}) {
  const [pauseDocs, setPauseDocs] = useState<PauseDoc[]>([]);
  const [showPauseForm, setShowPauseForm] = useState(false);
  const [reason, setReason] = useState("");
  const [estimatedResumeAt, setEstimatedResumeAt] = useState("");
  const [noteDraft, setNoteDraft] = useState("");
  const [noteError, setNoteError] = useState<string | null>(null);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, "Ticket", row.id, "PauseWindow"), (snap) => {
      setPauseDocs(
        snap.docs.map((d) => {
          const data = d.data();
          const pausedAt = data.pausedAt as Timestamp;
          const resumedAt = data.resumedAt as Timestamp | null;
          const estimatedResumeAt = data.estimatedResumeAt as Timestamp;
          return {
            id: d.id,
            pausedAtMs: pausedAt.toMillis(),
            resumedAtMs: resumedAt ? resumedAt.toMillis() : null,
            reason: data.reason as string,
            requestedBy: data.requestedBy as string,
            estimatedResumeAtMs: estimatedResumeAt.toMillis(),
            statusNote: (data.statusNote as string | null) ?? null,
          };
        }),
      );
    });
    return unsub;
  }, [row.id]);

  const openPause = useMemo(() => pauseDocs.find((p) => p.resumedAtMs == null) ?? null, [pauseDocs]);

  useEffect(() => {
    setNoteDraft(openPause?.statusNote ?? "");
  }, [openPause?.id, openPause?.statusNote]);

  const pauses: PauseInterval[] = useMemo(
    () => pauseDocs.map((p) => ({ pausedAtMs: p.pausedAtMs, resumedAtMs: p.resumedAtMs })),
    [pauseDocs],
  );

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

  const status: TicketWorkflowStatus = row.data.workflowStatus;
  const isPaused = status === "paused";

  async function saveNote() {
    if (!openPause) return;
    setNoteError(null);
    try {
      await updateDoc(doc(db, "Ticket", row.id, "PauseWindow", openPause.id), {
        statusNote: noteDraft,
      });
    } catch (err) {
      setNoteError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <>
      <tr className="border-b border-brand-border align-top">
        <td className="py-2">{row.data.title}</td>
        <td className="py-2">{row.data.category}</td>
        <td className="py-2">{row.data.priority}</td>
        <td className="py-2">{row.data.submittedAt.toDate().toLocaleString()}</td>
        <td className="py-2">{row.data.unit}</td>
        <td className="py-2">
          {isPaused ? <Badge variant="info">paused</Badge> : status}
        </td>
        <td className="py-2">
          {clockState ? (
            <Badge variant={slaUrgency(clockState)}>
              {clockState.clock === "acknowledgement" ? "Ack" : "Resolve"} SLA:{" "}
              {clockState.breached
                ? `BREACHED by ${formatDuration(clockState.elapsedMs - clockState.limitMs)}`
                : `${formatDuration(clockState.limitMs - clockState.elapsedMs)} left${isPaused ? " (paused)" : ""}`}
            </Badge>
          ) : (
            "—"
          )}
        </td>
        <td className="py-2">
          {status === "submitted" && (
            <Button onClick={() => onAcknowledge(row.id)} className="px-2 py-1 text-xs">
              Acknowledge
            </Button>
          )}
          {status === "acknowledged" && (
            <div className="flex gap-2">
              <Button onClick={() => setShowPauseForm((v) => !v)} className="px-2 py-1 text-xs">
                Pause for Parts
              </Button>
              <Button onClick={() => onResolve(row.id)} className="px-2 py-1 text-xs">
                Resolve
              </Button>
            </div>
          )}
          {status === "paused" && (
            <div className="flex gap-2">
              <Button onClick={() => onResume(row.id)} className="px-2 py-1 text-xs">
                Resume
              </Button>
              <Button onClick={() => onResolve(row.id)} className="px-2 py-1 text-xs">
                Resolve
              </Button>
            </div>
          )}
        </td>
      </tr>
      {isPaused && openPause && (
        <tr className="border-b border-brand-border bg-brand-info/10">
          <td colSpan={8} className="py-2">
            <div className="flex flex-wrap items-center gap-3 text-xs text-brand-primary/80">
              <span>
                <strong>Reason:</strong> {openPause.reason}
              </span>
              <span>
                <strong>Paused at:</strong> {new Date(openPause.pausedAtMs).toLocaleString()}
              </span>
              <span>
                <strong>Est. resume:</strong> {new Date(openPause.estimatedResumeAtMs).toLocaleString()}
              </span>
              <span>
                <strong>Requested by:</strong> {formatUid(openPause.requestedBy)}
              </span>
              <span className="flex items-center gap-1">
                <strong>Note:</strong>
                <Input
                  type="text"
                  value={noteDraft}
                  onChange={(e) => setNoteDraft(e.target.value)}
                  className="px-1 py-0.5"
                />
                <Button onClick={saveNote} className="px-2 py-0.5 text-xs">
                  Save
                </Button>
              </span>
              {noteError && <span className="text-brand-error">{noteError}</span>}
            </div>
          </td>
        </tr>
      )}
      {showPauseForm && (
        <tr className="border-b border-brand-border bg-brand-cream">
          <td colSpan={8} className="py-2">
            <div className="flex flex-wrap items-end gap-2">
              <Input
                type="text"
                placeholder="Reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="text-sm"
              />
              <Input
                type="datetime-local"
                value={estimatedResumeAt}
                onChange={(e) => setEstimatedResumeAt(e.target.value)}
                className="text-sm"
              />
              <Button
                onClick={() => {
                  onOpenPause(row.id, reason, new Date(estimatedResumeAt).toISOString());
                  setShowPauseForm(false);
                  setReason("");
                  setEstimatedResumeAt("");
                }}
                disabled={!reason || !estimatedResumeAt}
                className="px-2 py-1 text-xs"
              >
                Confirm pause
              </Button>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export default function ProviderQueuePage() {
  const { profile } = useCurrentUser();
  const [buildingName, setBuildingName] = useState<string | null>(null);
  const [rows, setRows] = useState<TicketRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const interval = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!profile) return;
    const providerId = profile.providerId as string;
    const homeBuildingId = profile.homeBuildingId as string;

    getDoc(doc(db, "Building", homeBuildingId)).then((snap) => {
      setBuildingName(snap.exists() ? (snap.data().name as string) : homeBuildingId);
    });

    // Query must match the rule's effective-access check exactly
    // (providerId + buildingId equality) for Firestore to prove every
    // possible result document satisfies the read rule.
    const q = query(
      collection(db, "Ticket"),
      where("providerId", "==", providerId),
      where("buildingId", "==", homeBuildingId),
      orderBy("submittedAt", "desc"),
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        setRows(snap.docs.map((d) => ({ id: d.id, data: d.data() as Ticket })));
        setLoading(false);
      },
      (err) => {
        setError(err.message);
        setLoading(false);
      },
    );
    return unsub;
  }, [profile]);

  async function callTransition(name: string, data: Record<string, unknown>) {
    setError(null);
    try {
      await httpsCallable(functions, name)(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  if (loading) return null;

  return (
    <main className="mx-auto max-w-5xl p-8">
      <h1 className="text-xl font-semibold text-brand-primary">Provider Queue — {buildingName}</h1>
      {error && <p className="mt-3 text-sm text-brand-error">{error}</p>}
      <Card className="mt-4">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-brand-border">
              <th className="py-2">Title</th>
              <th className="py-2">Category</th>
              <th className="py-2">Priority</th>
              <th className="py-2">Submitted</th>
              <th className="py-2">Unit</th>
              <th className="py-2">Status</th>
              <th className="py-2">SLA</th>
              <th className="py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <TicketRow
                key={row.id}
                row={row}
                nowMs={nowMs}
                onAcknowledge={(ticketId) => callTransition("acknowledge", { ticketId })}
                onOpenPause={(ticketId, reason, estimatedResumeAt) =>
                  callTransition("openPause", { ticketId, reason, estimatedResumeAt })
                }
                onResume={(ticketId) => callTransition("resumeTicket", { ticketId })}
                onResolve={(ticketId) => callTransition("resolveTicket", { ticketId })}
              />
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <p className="text-sm text-brand-primary/60">No tickets.</p>}
      </Card>
    </main>
  );
}
