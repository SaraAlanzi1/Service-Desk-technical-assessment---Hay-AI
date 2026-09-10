import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { currentClockState } from "@hay-service-desk/shared";
import {
  requireProviderStaff,
  loadTicketForTransition,
  timestampToMillis,
  firstBreachedAtToClockInput,
  Timestamp,
} from "./shared";

interface AcknowledgeRequest {
  ticketId: string;
}

function isAcknowledgeRequest(data: unknown): data is AcknowledgeRequest {
  return typeof data === "object" && data !== null && typeof (data as Record<string, unknown>).ticketId === "string";
}

export const acknowledge = onCall(async (request) => {
  const staffUid = requireProviderStaff(request);
  if (!isAcknowledgeRequest(request.data)) {
    throw new HttpsError("invalid-argument", "ticketId is required.");
  }
  const { ticketId } = request.data;

  const db = getFirestore();
  await db.runTransaction(async (transaction) => {
    const { ticketRef, ticket } = await loadTicketForTransition(transaction, ticketId, staffUid);

    if (ticket.workflowStatus !== "submitted") {
      throw new HttpsError(
        "failed-precondition",
        `Cannot acknowledge a ticket in status '${ticket.workflowStatus}'.`,
      );
    }

    const now = Timestamp.now();
    const nowMs = now.toMillis();

    const clockState = currentClockState(
      {
        workflowStatus: ticket.workflowStatus,
        submittedAtMs: timestampToMillis(ticket.submittedAt),
        acknowledgedAtMs: null,
        firstBreachedAt: firstBreachedAtToClockInput(ticket.firstBreachedAt),
      },
      [],
      nowMs,
    );

    const update: Record<string, unknown> = {
      workflowStatus: "acknowledged",
      acknowledgedAt: now,
      acknowledgedBy: staffUid,
    };

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
