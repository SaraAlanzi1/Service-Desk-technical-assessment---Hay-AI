import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { HttpsError, type CallableRequest } from "firebase-functions/v2/https";
import type { SlaClock, Ticket } from "@hay-service-desk/shared";

export function requireProviderStaff(request: CallableRequest): string {
  if (request.auth?.token?.role !== "providerStaff" || !request.auth.uid) {
    throw new HttpsError(
      "permission-denied",
      "Only provider staff can perform ticket transitions.",
    );
  }
  return request.auth.uid;
}

// "Effective access" per the design doc: homeBuildingId UNION any
// currently-active CoverageGrant (expiresAt > now AND revokedAt == null).
// Mirrors firestore.rules' hasBuildingAccess() exactly — reads
// effectiveGrants off the already-fetched ProviderStaff doc (zero extra
// reads), the same derived index rules use. CoverageGrant itself remains
// the source of truth; effectiveGrants is kept consistent with it via the
// same atomic client batch that writes both (see
// web/src/lib/coverageGrants.ts), not a trigger.
function hasBuildingAccess(staffProfile: FirebaseFirestore.DocumentData, buildingId: string): boolean {
  if (staffProfile.homeBuildingId === buildingId) return true;
  const grant = staffProfile.effectiveGrants?.[buildingId];
  if (!grant) return false;
  return grant.revokedAt == null && timestampToMillis(grant.expiresAt) > Date.now();
}

// Mirrors firestore.rules' canReadTicketData()/hasBuildingAccess() — Cloud
// Functions use the Admin SDK, which bypasses rules entirely, so this
// authorization check has to be re-enforced here in code.
export async function loadTicketForTransition(
  transaction: FirebaseFirestore.Transaction,
  ticketId: string,
  staffUid: string,
): Promise<{
  ticketRef: FirebaseFirestore.DocumentReference;
  ticket: Ticket;
}> {
  const db = getFirestore();
  const ticketRef = db.collection("Ticket").doc(ticketId);
  const staffRef = db.collection("ProviderStaff").doc(staffUid);

  const [ticketSnap, staffSnap] = await Promise.all([
    transaction.get(ticketRef),
    transaction.get(staffRef),
  ]);

  if (!ticketSnap.exists) {
    throw new HttpsError("not-found", "Ticket not found.");
  }
  if (!staffSnap.exists) {
    throw new HttpsError("failed-precondition", "Provider staff profile not found.");
  }

  const ticket = ticketSnap.data() as Ticket;
  const staff = staffSnap.data()!;

  const hasAccess =
    ticket.providerId === staff.providerId && hasBuildingAccess(staff, ticket.buildingId);

  if (!hasAccess) {
    throw new HttpsError("permission-denied", "You do not have access to this ticket.");
  }

  return { ticketRef, ticket };
}

export function timestampToMillis(value: unknown): number {
  return (value as FirebaseFirestore.Timestamp).toMillis();
}

// Converts Ticket.firstBreachedAt's stored shape into the plain-millis shape
// shared/sla.ts's currentClockState() expects.
export function firstBreachedAtToClockInput(
  firstBreachedAt: Ticket["firstBreachedAt"],
): { timestampMs: number; clock: SlaClock } | null {
  if (!firstBreachedAt) return null;
  return {
    timestampMs: timestampToMillis(firstBreachedAt.timestamp),
    clock: firstBreachedAt.clock,
  };
}

// Fetches every PauseWindow doc for a ticket within the transaction and
// finds the open ones (resumedAt == null). Centralized here so all three
// callers (openPause, resumeTicket, resolveTicket) apply the same "how many
// open pauses exist" integrity check the same way, rather than each
// re-implementing (and potentially silently guessing wrong).
export async function loadPauseWindows(
  transaction: FirebaseFirestore.Transaction,
  ticketRef: FirebaseFirestore.DocumentReference,
): Promise<{
  allDocs: FirebaseFirestore.QueryDocumentSnapshot[];
  openDocs: FirebaseFirestore.QueryDocumentSnapshot[];
}> {
  const snap = await transaction.get(ticketRef.collection("PauseWindow"));
  const allDocs = snap.docs;
  const openDocs = allDocs.filter((d) => d.data().resumedAt == null);
  return { allDocs, openDocs };
}

export function logIntegrityError(context: string, details: Record<string, unknown>): void {
  logger.error(`[data-integrity] ${context}`, details);
}

export { Timestamp };
