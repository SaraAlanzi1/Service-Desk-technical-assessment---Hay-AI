import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { currentClockState, type PauseInterval } from "@hay-service-desk/shared";
import {
  requireProviderStaff,
  loadTicketForTransition,
  loadPauseWindows,
  timestampToMillis,
  firstBreachedAtToClockInput,
  Timestamp,
} from "./shared";

interface OpenPauseRequest {
  ticketId: string;
  reason: string;
  estimatedResumeAt: string;
}

function isOpenPauseRequest(data: unknown): data is OpenPauseRequest {
  if (typeof data !== "object" || data === null) return false;
  const d = data as Record<string, unknown>;
  return (
    typeof d.ticketId === "string" &&
    typeof d.reason === "string" &&
    typeof d.estimatedResumeAt === "string"
  );
}

export const openPause = onCall(async (request) => {
  const staffUid = requireProviderStaff(request);
  if (!isOpenPauseRequest(request.data)) {
    throw new HttpsError(
      "invalid-argument",
      "ticketId, reason, and estimatedResumeAt are required.",
    );
  }
  const { ticketId, reason, estimatedResumeAt } = request.data;

  const db = getFirestore();
  await db.runTransaction(async (transaction) => {
    const { ticketRef, ticket } = await loadTicketForTransition(transaction, ticketId, staffUid);

    if (ticket.workflowStatus !== "acknowledged") {
      throw new HttpsError(
        "failed-precondition",
        `Cannot pause a ticket in status '${ticket.workflowStatus}'.`,
      );
    }

    // Under normal operation workflowStatus === 'acknowledged' already
    // guarantees no pause is open. This is a defensive double-check against
    // that invariant (and the concurrent-request race: two openPause calls
    // can both pass the status guard above before either commits, but only
    // one of them wins the transaction — the other retries, re-reads
    // workflowStatus as 'paused', and is rejected by the guard above instead
    // of reaching this point at all).
    const { allDocs: pastPauses, openDocs } = await loadPauseWindows(transaction, ticketRef);
    if (openDocs.length > 0) {
      throw new HttpsError("failed-precondition", "This ticket already has an open pause.");
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
      requestedBy: staffUid,
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
