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

interface ResolveTicketRequest {
  ticketId: string;
}

function isResolveTicketRequest(data: unknown): data is ResolveTicketRequest {
  return typeof data === "object" && data !== null && typeof (data as Record<string, unknown>).ticketId === "string";
}

export const resolveTicket = onCall(async (request) => {
  const staffUid = requireProviderStaff(request);
  if (!isResolveTicketRequest(request.data)) {
    throw new HttpsError("invalid-argument", "ticketId is required.");
  }
  const { ticketId } = request.data;

  const db = getFirestore();
  await db.runTransaction(async (transaction) => {
    const { ticketRef, ticket } = await loadTicketForTransition(transaction, ticketId, staffUid);

    if (ticket.workflowStatus !== "acknowledged" && ticket.workflowStatus !== "paused") {
      throw new HttpsError(
        "failed-precondition",
        `Cannot resolve a ticket in status '${ticket.workflowStatus}'.`,
      );
    }

    const { allDocs, openDocs } = await loadPauseWindows(transaction, ticketRef);

    // Only meaningful when resolving directly from 'paused' — resolving
    // from 'acknowledged' with zero open pauses is the normal, expected
    // case, not an integrity error.
    if (ticket.workflowStatus === "paused") {
      if (openDocs.length === 0) {
        throw new HttpsError(
          "failed-precondition",
          "Ticket is paused but has no open pause window.",
        );
      }
      if (openDocs.length > 1) {
        logIntegrityError("resolveTicket: multiple open PauseWindows", {
          ticketId,
          openPauseIds: openDocs.map((d) => d.id),
        });
        throw new HttpsError(
          "internal",
          "Data integrity error: more than one open pause window exists for this ticket.",
        );
      }
    }

    const now = Timestamp.now();
    const nowMs = now.toMillis();
    const openPauseRef = openDocs[0]?.ref ?? null;

    const pauses: PauseInterval[] = allDocs.map((d) => {
      const data = d.data();
      const isOpen = data.resumedAt == null;
      return {
        pausedAtMs: timestampToMillis(data.pausedAt),
        resumedAtMs: isOpen ? nowMs : timestampToMillis(data.resumedAt),
      };
    });

    const clockState = currentClockState(
      {
        workflowStatus: "acknowledged", // final elapsed as of resolution, same clock either way
        submittedAtMs: timestampToMillis(ticket.submittedAt),
        acknowledgedAtMs: timestampToMillis(ticket.acknowledgedAt),
        firstBreachedAt: firstBreachedAtToClockInput(ticket.firstBreachedAt),
      },
      pauses,
      nowMs,
    );

    // paused -> resolved auto-closes the open PauseWindow atomically, in
    // this same transaction.
    if (openPauseRef) {
      transaction.update(openPauseRef, { resumedAt: now, resumedBy: staffUid });
    }

    const update: Record<string, unknown> = {
      workflowStatus: "resolved",
      resolvedAt: now,
      resolvedBy: staffUid,
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
