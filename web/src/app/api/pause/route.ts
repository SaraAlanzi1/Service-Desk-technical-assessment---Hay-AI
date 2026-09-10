import { getAdminDb } from "@/lib/firebase/admin";
import { withAuth } from "@/lib/api/withAuth";
import { ApiError } from "@/lib/api/httpError";
import { currentClockState, type PauseInterval } from "@hay-service-desk/shared";
import {
  loadTicketForTransition,
  loadPauseWindows,
  timestampToMillis,
  firstBreachedAtToClockInput,
  Timestamp,
} from "@/lib/api/ticketTransitions";

// Production equivalent of functions/src/transitions/openPause.ts.
export const POST = withAuth(async ({ uid, role, body }) => {
  if (role !== "providerStaff") {
    throw new ApiError(403, "Only provider staff can perform ticket transitions.");
  }
  const { ticketId, reason, estimatedResumeAt } = body as {
    ticketId?: string;
    reason?: string;
    estimatedResumeAt?: string;
  };
  if (typeof ticketId !== "string" || typeof reason !== "string" || typeof estimatedResumeAt !== "string") {
    throw new ApiError(400, "ticketId, reason, and estimatedResumeAt are required.");
  }

  const adminDb = getAdminDb();
  await adminDb.runTransaction(async (transaction) => {
    const { ticketRef, ticket } = await loadTicketForTransition(adminDb, transaction, ticketId, uid);

    if (ticket.workflowStatus !== "acknowledged") {
      throw new ApiError(409, `Cannot pause a ticket in status '${ticket.workflowStatus}'.`);
    }

    const { allDocs: pastPauses, openDocs } = await loadPauseWindows(transaction, ticketRef);
    if (openDocs.length > 0) {
      throw new ApiError(409, "This ticket already has an open pause.");
    }

    const now = Timestamp.now();
    const nowMs = now.toMillis();

    const pauses: PauseInterval[] = pastPauses.map((d) => {
      const data = d.data();
      return {
        pausedAtMs: timestampToMillis(data.pausedAt),
        resumedAtMs: data.resumedAt ? timestampToMillis(data.resumedAt) : nowMs,
      };
    });

    const clockState = currentClockState(
      {
        workflowStatus: ticket.workflowStatus,
        submittedAtMs: timestampToMillis(ticket.submittedAt),
        acknowledgedAtMs: timestampToMillis(ticket.acknowledgedAt),
        firstBreachedAt: firstBreachedAtToClockInput(ticket.firstBreachedAt),
      },
      pauses,
      nowMs,
    );

    const pauseRef = ticketRef.collection("PauseWindow").doc();
    transaction.set(pauseRef, {
      pausedAt: now,
      resumedAt: null,
      reason,
      requestedBy: uid,
      resumedBy: null,
      estimatedResumeAt: Timestamp.fromDate(new Date(estimatedResumeAt)),
      statusNote: null,
    });

    const update: Record<string, unknown> = { workflowStatus: "paused" };
    if (clockState?.breached && ticket.firstBreachedAt == null) {
      update.firstBreachedAt = {
        timestamp: Timestamp.fromMillis(clockState.breachThresholdMs),
        clock: clockState.clock,
      };
    }
    transaction.update(ticketRef, update);
  });

  return { ok: true };
});
