// Data model per design doc §2. Field lists are exact — do not add or infer
// fields beyond what's documented there.

// Milestone 1: role determination. Not a Firestore field — this is the
// literal value written to the `role` custom claim by the Cloud Functions
// trigger and read back via request.auth.token.role in Security Rules and
// web/'s auth hook. Defined once here so both sides can't drift on spelling.
export type Role = "tenant" | "providerStaff" | "operatorAdmin";

// Structural stand-in for Firestore's Timestamp. web/ (client SDK) and
// functions/ (Admin SDK) each have their own Timestamp class; this interface
// avoids tying shared/ to either SDK. Both classes satisfy this shape.
export interface FirestoreTimestamp {
  readonly seconds: number;
  readonly nanoseconds: number;
  toDate(): Date;
  toMillis(): number;
}

// ── Building ─────────────────────────────────────────────────────────────
// 6 fixed documents.
export interface Building {
  id: string;
  name: string;
  address: string;
}

// ── Tenant ───────────────────────────────────────────────────────────────
// Firebase Auth-backed profile.
export interface Tenant {
  uid: string;
  name: string;
  email: string;
  // Admin-provisioned only; not self-editable by the tenant.
  buildingId: string;
  unit: string;
}

// Milestone 6: a derived authorization index, NOT the source of truth —
// CoverageGrant remains authoritative. Mirrors the caller's own
// CoverageGrant docs, kept consistent by writing both in the same atomic
// Firestore batch (no Cloud Function trigger — an async trigger would open
// a window where the grant exists but access isn't yet granted, or a
// revoke has landed but access isn't yet revoked). Firestore Security
// Rules can only get()/exists() an exact path, never query, so this index
// is what lets rules evaluate live grant status against the
// already-fetched ProviderStaff doc with zero extra reads.
export interface EffectiveGrantEntry {
  grantId: string;
  expiresAt: FirestoreTimestamp;
  revokedAt: FirestoreTimestamp | null;
}

// ── ProviderStaff ────────────────────────────────────────────────────────
// Firebase Auth-backed profile.
export interface ProviderStaff {
  uid: string;
  name: string;
  email: string;
  // Admin-managed; immutable by staff.
  providerId: string;
  // Standing assignment; extended temporarily by live CoverageGrants.
  homeBuildingId: string;
  // Keyed by buildingId. May be absent on profiles that have never had a
  // grant issued.
  effectiveGrants?: Record<string, EffectiveGrantEntry>;
}

// ── OperatorAdmin ────────────────────────────────────────────────────────
// Firebase Auth-backed profile. No scope fields — admin is global by role.
export interface OperatorAdmin {
  uid: string;
  name: string;
  email: string;
}

// ── Provider ─────────────────────────────────────────────────────────────
// 2 fixed documents: cleaning, maintenance.
export type ProviderServiceType = "cleaning" | "maintenance";

export interface Provider {
  id: string;
  name: string;
  serviceType: ProviderServiceType;
}

// ── Ticket ───────────────────────────────────────────────────────────────
export type TicketCategory = "cleaning" | "maintenance";
export type TicketPriority = "low" | "medium" | "high";
// in_progress is UI-derived, never stored.
export type TicketWorkflowStatus =
  | "submitted"
  | "acknowledged"
  | "paused"
  | "resolved";
export type SlaClock = "acknowledgement" | "resolve";

export interface TicketBreachEvent {
  timestamp: FirestoreTimestamp;
  clock: SlaClock;
}

export interface Ticket {
  id: string;
  buildingId: string;
  // Denormalized from Tenant.unit to avoid a join in the provider queue view.
  unit: string;
  tenantId: string;
  // Set once at creation from category mapping; immutable afterward.
  providerId: string;
  category: TicketCategory;
  title: string;
  description: string;
  photos: string[];
  priority: TicketPriority;
  // Mutable only via guarded Cloud Functions.
  workflowStatus: TicketWorkflowStatus;
  submittedAt: FirestoreTimestamp;
  acknowledgedAt: FirestoreTimestamp | null;
  acknowledgedBy: string | null;
  resolvedAt: FirestoreTimestamp | null;
  resolvedBy: string | null;
  // "Breach once, breach forever": persists once observed, never cleared.
  // There is intentionally no stored `breached` boolean — live breach status
  // is always computed from timestamps + PauseWindows + the hardcoded SLA
  // constants.
  firstBreachedAt: TicketBreachEvent | null;
}

// ── PauseWindow (subcollection under Ticket) ────────────────────────────
export interface PauseWindow {
  id: string;
  pausedAt: FirestoreTimestamp;
  // Null while the window is open.
  resumedAt: FirestoreTimestamp | null;
  reason: string;
  requestedBy: string;
  // Also covers the auto-close-on-resolve path (paused → resolved).
  resumedBy: string | null;
  estimatedResumeAt: FirestoreTimestamp;
  statusNote: string | null;
}

// ── CoverageGrant ────────────────────────────────────────────────────────
export interface CoverageGrant {
  id: string;
  providerStaffId: string;
  buildingId: string;
  grantedBy: string;
  grantedAt: FirestoreTimestamp;
  // Mandatory; checked live by Security Rules (expiresAt > request.time).
  expiresAt: FirestoreTimestamp;
  // Distinguishes early manual revocation from natural expiry.
  revokedAt: FirestoreTimestamp | null;
}

// ── MonthlyReport ────────────────────────────────────────────────────────
// Persisted snapshot, not live-computed.
export interface MonthlyReport {
  id: string;
  providerId: string;
  month: number;
  year: number;
  generatedAt: FirestoreTimestamp;
  generatedBy: string;
  openCount: number;
  breachedCount: number;
  // SLA-adjusted: for each resolved ticket in period,
  // (resolvedAt - acknowledgedAt) - sum(pause durations); averaged.
  avgResolveTimeMinutes: number;
  totalTickets: number;
}
