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

// Production equivalent of functions/src/transitions/resolveTicket.ts.
export const POST = withAuth(async ({ uid, role, body }) => {
  if (role !== "providerStaff") {
    throw new ApiError(403, "Only provider staff can perform ticket transitions.");
  }
  const { ticketId } = body as { ticketId?: string };
  if (typeof ticketId !== "string") {
    throw new ApiError(400, "ticketId is required.");
  }

  const adminDb = getAdminDb();
  await adminDb.runTransaction(async (transaction) => {
    const { ticketRef, ticket } = await loadTicketForTransition(adminDb, transaction, ticketId, uid);

    if (ticket.workflowStatus !== "acknowledged" && ticket.workflowStatus !== "paused") {
      throw new ApiError(409, `Cannot resolve a ticket in status '${ticket.workflowStatus}'.`);
    }

    const { allDocs, openDocs } = await loadPauseWindows(transaction, ticketRef);

    if (ticket.workflowStatus === "paused") {
      if (openDocs.length === 0) {
        throw new ApiError(409, "Ticket is paused but has no open pause window.");
      }
      if (openDocs.length > 1) {
        console.error("[data-integrity] resolveTicket: multiple open PauseWindows", {
          ticketId,
          openPauseIds: openDocs.map((d) => d.id),
        });
        throw new ApiError(500, "Data integrity error: more than one open pause window exists for this ticket.");
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
        workflowStatus: "acknowledged",
        submittedAtMs: timestampToMillis(ticket.submittedAt),
        acknowledgedAtMs: timestampToMillis(ticket.acknowledgedAt),
        firstBreachedAt: firstBreachedAtToClockInput(ticket.firstBreachedAt),
      },
      pauses,
      nowMs,
    );

    if (openPauseRef) {
      transaction.update(openPauseRef, { resumedAt: now, resumedBy: uid });
    }

    const update: Record<string, unknown> = {
      workflowStatus: "resolved",
      resolvedAt: now,
      resolvedBy: uid,
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
