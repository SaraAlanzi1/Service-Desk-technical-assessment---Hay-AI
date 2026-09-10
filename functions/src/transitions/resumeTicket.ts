import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { currentClockState, type PauseInterval } from "@hay-service-desk/shared";
import {
  requireProviderStaff,
  loadTicketForTransition,
  loadPauseWindows,
  timestampToMillis,
  firstBreachedAtToClockInput,
  logIntegrityError,
  Timestamp,
} from "./shared";

interface ResumeTicketRequest {
  ticketId: string;
}

function isResumeTicketRequest(data: unknown): data is ResumeTicketRequest {
  return typeof data === "object" && data !== null && typeof (data as Record<string, unknown>).ticketId === "string";
}

export const resumeTicket = onCall(async (request) => {
  const staffUid = requireProviderStaff(request);
  if (!isResumeTicketRequest(request.data)) {
    throw new HttpsError("invalid-argument", "ticketId is required.");
  }
  const { ticketId } = request.data;

  const db = getFirestore();
  await db.runTransaction(async (transaction) => {
    const { ticketRef, ticket } = await loadTicketForTransition(transaction, ticketId, staffUid);

    if (ticket.workflowStatus !== "paused") {
      throw new HttpsError(
        "failed-precondition",
        `Cannot resume a ticket in status '${ticket.workflowStatus}'.`,
      );
    }

    const { allDocs, openDocs } = await loadPauseWindows(transaction, ticketRef);

    if (openDocs.length === 0) {
      throw new HttpsError("failed-precondition", "No open pause window found for a paused ticket.");
    }
    if (openDocs.length > 1) {
      logIntegrityError("resumeTicket: multiple open PauseWindows", {
        ticketId,
        openPauseIds: openDocs.map((d) => d.id),
      });
      throw new HttpsError(
        "internal",
        "Data integrity error: more than one open pause window exists for this ticket.",
      );
    }
    const openPauseDoc = openDocs[0];

    const now = Timestamp.now();
    const nowMs = now.toMillis();

    const pauses: PauseInterval[] = allDocs.map((d) => {
      const data = d.data();
      const isOpen = d.id === openPauseDoc.id;
      return {
        pausedAtMs: timestampToMillis(data.pausedAt),
        resumedAtMs: isOpen ? nowMs : timestampToMillis(data.resumedAt),
      };
    });

    const clockState = currentClockState(
      {
        workflowStatus: "acknowledged", // resuming returns to the running-clock state
        submittedAtMs: timestampToMillis(ticket.submittedAt),
        acknowledgedAtMs: timestampToMillis(ticket.acknowledgedAt),
        firstBreachedAt: firstBreachedAtToClockInput(ticket.firstBreachedAt),
      },
      pauses,
      nowMs,
    );

    transaction.update(openPauseDoc.ref, {
      resumedAt: now,
      resumedBy: staffUid,
    });

    const update: Record<string, unknown> = { workflowStatus: "acknowledged" };
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
