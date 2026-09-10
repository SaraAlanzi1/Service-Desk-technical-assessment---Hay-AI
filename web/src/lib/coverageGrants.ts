// Admin issuance/revocation flow for CoverageGrant. No visual UI exists for
// this yet (out of scope per prior instructions) — this is the functional
// plumbing a future admin page, or a script, would call.
//
// CoverageGrant remains the source of truth (auto-generated ID, full
// history, never overwritten). ProviderStaff.effectiveGrants is a derived
// authorization index that Security Rules read instead of querying
// CoverageGrant directly (which rules structurally cannot do). Both
// documents are written in the SAME atomic Firestore batch — no Cloud
// Function trigger — so there is never a window where one reflects a grant
// change the other doesn't.
import { doc, collection, getDoc, serverTimestamp, Timestamp, writeBatch } from "firebase/firestore";
import { db } from "@/lib/firebase/client";

export interface IssueCoverageGrantInput {
  providerStaffId: string;
  buildingId: string;
  expiresAt: Date;
  grantedBy: string;
}

// Reissuing for a (staff, building) pair that already has a grant is
// expected and always allowed: the previous CoverageGrant document is left
// completely untouched (preserving its own history), and this batch only
// repoints effectiveGrants[buildingId] at the new grant.
export async function issueCoverageGrant(input: IssueCoverageGrantInput): Promise<string> {
  const grantRef = doc(collection(db, "CoverageGrant"));
  const staffRef = doc(db, "ProviderStaff", input.providerStaffId);
  const expiresAt = Timestamp.fromDate(input.expiresAt);

  const batch = writeBatch(db);
  batch.set(grantRef, {
    providerStaffId: input.providerStaffId,
    buildingId: input.buildingId,
    grantedBy: input.grantedBy,
    grantedAt: serverTimestamp(),
    expiresAt,
    revokedAt: null,
  });
  batch.update(staffRef, {
    [`effectiveGrants.${input.buildingId}`]: {
      grantId: grantRef.id,
      expiresAt,
      revokedAt: null,
    },
  });
  await batch.commit();
  return grantRef.id;
}

export interface RevokeCoverageGrantInput {
  grantId: string;
  providerStaffId: string;
  buildingId: string;
}

// CoverageGrant has no client read rule (by design — nothing else in this
// project needs to list grants either), so the caller must already know
// providerStaffId/buildingId for the grant being revoked — there's no way
// to derive them from grantId alone via the client SDK. In practice
// whoever issued the grant already has this from issueCoverageGrant's own
// input/return value.
export async function revokeCoverageGrant(input: RevokeCoverageGrantInput): Promise<void> {
  const grantRef = doc(db, "CoverageGrant", input.grantId);
  const staffRef = doc(db, "ProviderStaff", input.providerStaffId);

  // Only touch the pointer if this grant is CURRENTLY the active one for
  // this (staff, building) pair — matching the rule's isCurrentPointer
  // check exactly. Revoking an older, already-superseded grant must never
  // touch a newer grant's pointer entry.
  const staffSnap = await getDoc(staffRef);
  const currentPointer = staffSnap.data()?.effectiveGrants?.[input.buildingId] as
    | { grantId: string; expiresAt: Timestamp; revokedAt: Timestamp | null }
    | undefined;
  const isCurrentPointer = currentPointer?.grantId === input.grantId;

  const batch = writeBatch(db);
  batch.update(grantRef, { revokedAt: serverTimestamp() });
  if (isCurrentPointer && currentPointer) {
    batch.update(staffRef, {
      [`effectiveGrants.${input.buildingId}`]: {
        grantId: input.grantId,
        expiresAt: currentPointer.expiresAt,
        revokedAt: serverTimestamp(),
      },
    });
  }
  await batch.commit();
}
