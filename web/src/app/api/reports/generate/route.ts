import { getAdminDb } from "@/lib/firebase/admin";
import { withAuth } from "@/lib/api/withAuth";
import { ApiError } from "@/lib/api/httpError";
import { averageResolveTimeMinutes, currentClockState, type PauseInterval } from "@hay-service-desk/shared";
import { timestampToMillis, firstBreachedAtToClockInput, Timestamp } from "@/lib/api/ticketTransitions";

// Deterministic doc ID so "regenerate" (overwrite if a report for the same
// provider/month/year already exists) is a plain set() — same convention as
// functions/src/reports/generateMonthlyReport.ts.
function reportDocId(providerId: string, year: number, month: number): string {
  return `${providerId}-${year}-${month}`;
}

// Production equivalent of functions/src/reports/generateMonthlyReport.ts —
// identical sweep-gap handling (live-recompute + lazy persist of
// firstBreachedAt for tickets that breached without ever being touched).
export const POST = withAuth(async ({ uid, role, body }) => {
  if (role !== "operatorAdmin") {
    throw new ApiError(403, "Only operator admins can generate monthly reports.");
  }
  const { providerId, month, year } = body as { providerId?: string; month?: number; year?: number };
  if (
    typeof providerId !== "string" ||
    typeof month !== "number" ||
    !Number.isInteger(month) ||
    month < 1 ||
    month > 12 ||
    typeof year !== "number" ||
    !Number.isInteger(year)
  ) {
    throw new ApiError(400, "providerId, month (1-12), and year are required.");
  }

  const monthStartMs = Date.UTC(year, month - 1, 1);
  const monthEndMs = Date.UTC(year, month, 1);

  const adminDb = getAdminDb();
  const ticketsSnap = await adminDb
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
        await adminDb.runTransaction(async (transaction) => {
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

    if (
      ticket.workflowStatus === "resolved" &&
      resolvedAtMs !== null &&
      resolvedAtMs >= monthStartMs &&
      resolvedAtMs < monthEndMs
    ) {
      const pausesSnap = await doc.ref.collection("PauseWindow").get();
      const pauses: PauseInterval[] = pausesSnap.docs.map((p) => {
        const data = p.data();
        return {
          pausedAtMs: timestampToMillis(data.pausedAt),
          resumedAtMs: data.resumedAt ? timestampToMillis(data.resumedAt) : resolvedAtMs,
        };
      });
      resolveEntries.push({ acknowledgedAtMs: timestampToMillis(ticket.acknowledgedAt), pauses, resolvedAtMs });
    }
  }

  const avgResolveTimeMinutes = averageResolveTimeMinutes(resolveEntries);

  const reportRef = adminDb.collection("MonthlyReport").doc(reportDocId(providerId, year, month));
  await reportRef.set({
    providerId,
    month,
    year,
    generatedAt: Timestamp.now(),
    generatedBy: uid,
    openCount,
    breachedCount,
    avgResolveTimeMinutes,
    totalTickets,
  });

  return { ok: true, reportId: reportRef.id };
});
