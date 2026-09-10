import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { averageResolveTimeMinutes, currentClockState, type PauseInterval } from "@hay-service-desk/shared";
import { timestampToMillis, firstBreachedAtToClockInput } from "../transitions/shared";

interface GenerateMonthlyReportRequest {
  providerId: string;
  month: number;
  year: number;
}

function isGenerateMonthlyReportRequest(data: unknown): data is GenerateMonthlyReportRequest {
  if (typeof data !== "object" || data === null) return false;
  const d = data as Record<string, unknown>;
  return (
    typeof d.providerId === "string" &&
    typeof d.month === "number" &&
    Number.isInteger(d.month) &&
    d.month >= 1 &&
    d.month <= 12 &&
    typeof d.year === "number" &&
    Number.isInteger(d.year)
  );
}

// Deterministic doc ID so "regenerate" (per spec: overwrite if a report for
// the same provider/month/year already exists) is a plain set(), not a
// query-then-conditional-update. Not a design-doc-specified convention —
// MonthlyReport's schema just says "id: string (doc ID)" with no composite
// key scheme, so this is a call made here to satisfy the explicit overwrite
// requirement.
function reportDocId(providerId: string, year: number, month: number): string {
  return `${providerId}-${year}-${month}`;
}

export const generateMonthlyReport = onCall(async (request) => {
  if (request.auth?.token?.role !== "operatorAdmin" || !request.auth.uid) {
    throw new HttpsError("permission-denied", "Only operator admins can generate monthly reports.");
  }
  if (!isGenerateMonthlyReportRequest(request.data)) {
    throw new HttpsError("invalid-argument", "providerId, month (1-12), and year are required.");
  }
  const { providerId, month, year } = request.data;
  const adminUid = request.auth.uid;

  // UTC month boundaries: [monthStart, monthEnd).
  const monthStartMs = Date.UTC(year, month - 1, 1);
  const monthEndMs = Date.UTC(year, month, 1);

  const db = getFirestore();
  const ticketsSnap = await db
    .collection("Ticket")
    .where("providerId", "==", providerId)
    .where("submittedAt", ">=", Timestamp.fromMillis(monthStartMs))
    .where("submittedAt", "<", Timestamp.fromMillis(monthEndMs))
    .get();

  const totalTickets = ticketsSnap.size;

  let openCount = 0;
  let breachedCount = 0;
  const resolveEntries: Array<{ acknowledgedAtMs: number; pauses: PauseInterval[]; resolvedAtMs: number }> = [];

  for (const doc of ticketsSnap.docs) {
    const ticket = doc.data();

    const resolvedAtMs = ticket.resolvedAt ? timestampToMillis(ticket.resolvedAt) : null;
    const notYetResolvedByMonthEnd =
      ticket.workflowStatus !== "resolved" || (resolvedAtMs !== null && resolvedAtMs > monthEndMs);
    if (notYetResolvedByMonthEnd) openCount++;

    // Resolved tickets always have a reliable firstBreachedAt (resolveTicket
    // itself performs the final breach check as a precondition of ever
    // reaching that state), so trusting the stored field is correct there.
    // Non-resolved tickets are exactly where the sweep gap lives: a ticket
    // can sit past its deadline with no transition ever called on it. For
    // those, live-recompute using the same shared SLA logic every
    // transition function uses, and lazily persist firstBreachedAt if this
    // is the first time the breach is being observed — using the real
    // retroactive threshold instant, not "now", so the field's historical
    // meaning is unchanged from what a transition function would have
    // written at the time it actually breached.
    let firstBreachedAt = ticket.firstBreachedAt ?? null;
    if (!firstBreachedAt && ticket.workflowStatus !== "resolved") {
      const openPausesSnap = await doc.ref.collection("PauseWindow").get();
      const openPauses: PauseInterval[] = openPausesSnap.docs.map((p) => {
        const data = p.data();
        return {
          pausedAtMs: timestampToMillis(data.pausedAt),
          resumedAtMs: data.resumedAt ? timestampToMillis(data.resumedAt) : Date.now(),
        };
      });
      const clockState = currentClockState(
        {
          workflowStatus: ticket.workflowStatus,
          submittedAtMs: timestampToMillis(ticket.submittedAt),
          acknowledgedAtMs: ticket.acknowledgedAt ? timestampToMillis(ticket.acknowledgedAt) : null,
          firstBreachedAt: firstBreachedAtToClockInput(ticket.firstBreachedAt ?? null),
        },
        openPauses,
        Date.now(),
      );
      if (clockState?.breached) {
        const newFirstBreachedAt = {
          timestamp: Timestamp.fromMillis(clockState.breachThresholdMs),
          clock: clockState.clock,
        };
        // Guard against a race with a real transition function stamping
        // this concurrently: only write if it's still null by the time this
        // runs.
        await db.runTransaction(async (transaction) => {
          const freshSnap = await transaction.get(doc.ref);
          if (freshSnap.data()?.firstBreachedAt == null) {
            transaction.update(doc.ref, { firstBreachedAt: newFirstBreachedAt });
          }
        });
        firstBreachedAt = newFirstBreachedAt;
      }
    }

    if (firstBreachedAt) {
      const breachMs = timestampToMillis(firstBreachedAt.timestamp);
      if (breachMs >= monthStartMs && breachMs < monthEndMs) breachedCount++;
    }

    if (ticket.workflowStatus === "resolved" && resolvedAtMs !== null && resolvedAtMs >= monthStartMs && resolvedAtMs < monthEndMs) {
      const pausesSnap = await doc.ref.collection("PauseWindow").get();
      const pauses: PauseInterval[] = pausesSnap.docs.map((p) => {
        const data = p.data();
        return {
          pausedAtMs: timestampToMillis(data.pausedAt),
          resumedAtMs: data.resumedAt ? timestampToMillis(data.resumedAt) : resolvedAtMs,
        };
      });
      resolveEntries.push({
        acknowledgedAtMs: timestampToMillis(ticket.acknowledgedAt),
        pauses,
        resolvedAtMs,
      });
    }
  }

  const avgResolveTimeMinutes = averageResolveTimeMinutes(resolveEntries);

  const reportRef = db.collection("MonthlyReport").doc(reportDocId(providerId, year, month));
  await reportRef.set({
    providerId,
    month,
    year,
    generatedAt: Timestamp.now(),
    generatedBy: adminUid,
    openCount,
    breachedCount,
    avgResolveTimeMinutes,
    totalTickets,
  });

  return { ok: true, reportId: reportRef.id };
});
