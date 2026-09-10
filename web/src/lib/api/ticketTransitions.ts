import { Timestamp, type DocumentData, type DocumentReference, type Firestore, type Transaction } from "firebase-admin/firestore";
import type { SlaClock, Ticket } from "@hay-service-desk/shared";
import { ApiError } from "./httpError";

// Deliberate duplicate of functions/src/transitions/shared.ts's
// authorization/loading logic, adapted to throw ApiError instead of
// HttpsError. Kept as a byte-for-byte equivalent on purpose rather than
// imported, so the Cloud Functions emulator path (functions/) — the local
// dev workflow — stays completely untouched and independently verifiable.
// Any change to this authorization/transition logic must be applied to
// BOTH copies; functions/src/transitions/shared.ts is the original.

// "Effective access" per the locked design: homeBuildingId UNION any
// currently-active CoverageGrant (expiresAt > now AND revokedAt == null).
export function hasBuildingAccess(staffProfile: DocumentData, buildingId: string): boolean {
  if (staffProfile.homeBuildingId === buildingId) return true;
  const grant = staffProfile.effectiveGrants?.[buildingId];
  if (!grant) return false;
  return grant.revokedAt == null && timestampToMillis(grant.expiresAt) > Date.now();
}

export async function loadTicketForTransition(
  db: Firestore,
  transaction: Transaction,
  ticketId: string,
  staffUid: string,
): Promise<{
  ticketRef: DocumentReference;
  ticket: Ticket;
}> {
  const ticketRef = db.collection("Ticket").doc(ticketId);
  const staffRef = db.collection("ProviderStaff").doc(staffUid);

  const [ticketSnap, staffSnap] = await Promise.all([transaction.get(ticketRef), transaction.get(staffRef)]);

  if (!ticketSnap.exists) {
    throw new ApiError(404, "Ticket not found.");
  }
  if (!staffSnap.exists) {
    throw new ApiError(400, "Provider staff profile not found.");
  }

  const ticket = ticketSnap.data() as Ticket;
  const staff = staffSnap.data()!;

  const hasAccess = ticket.providerId === staff.providerId && hasBuildingAccess(staff, ticket.buildingId);
  if (!hasAccess) {
    throw new ApiError(403, "You do not have access to this ticket.");
  }

  return { ticketRef, ticket };
}

export function timestampToMillis(value: unknown): number {
  return (value as Timestamp).toMillis();
}

export function firstBreachedAtToClockInput(
  firstBreachedAt: Ticket["firstBreachedAt"],
): { timestampMs: number; clock: SlaClock } | null {
  if (!firstBreachedAt) return null;
  return {
    timestampMs: timestampToMillis(firstBreachedAt.timestamp),
    clock: firstBreachedAt.clock,
  };
}

export async function loadPauseWindows(
  transaction: Transaction,
  ticketRef: DocumentReference,
): Promise<{
  allDocs: FirebaseFirestore.QueryDocumentSnapshot[];
  openDocs: FirebaseFirestore.QueryDocumentSnapshot[];
}> {
  const snap = await transaction.get(ticketRef.collection("PauseWindow"));
  const allDocs = snap.docs;
  const openDocs = allDocs.filter((d) => d.data().resumedAt == null);
  return { allDocs, openDocs };
}

export { Timestamp };
