import { getAdminDb } from "@/lib/firebase/admin";
import { withAuth } from "@/lib/api/withAuth";
import { ApiError } from "@/lib/api/httpError";
import { currentClockState } from "@hay-service-desk/shared";
import {
  loadTicketForTransition,
  timestampToMillis,
  firstBreachedAtToClockInput,
  Timestamp,
} from "@/lib/api/ticketTransitions";

// Production equivalent of functions/src/transitions/acknowledge.ts — same
// transaction, same state-machine guard, same SLA/breach logic (imported
// from @hay-service-desk/shared, not reimplemented).
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

    if (ticket.workflowStatus !== "submitted") {
      throw new ApiError(409, `Cannot acknowledge a ticket in status '${ticket.workflowStatus}'.`);
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
      acknowledgedBy: uid,
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
