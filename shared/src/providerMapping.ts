import type { TicketCategory } from "./types";

// Per design doc cross-collection notes: "providerId <-> category mapping is
// a hardcoded 2-entry constant in code. Not a Firestore document." web/ uses
// this directly when constructing a new Ticket.
//
// DUPLICATION WARNING: Firestore Security Rules cannot import shared code,
// so these exact ID strings are ALSO hardcoded as literals inside
// firestore.rules (see categoryProviderId() there). If these IDs ever
// change, both places must be updated together.
export const CATEGORY_TO_PROVIDER_ID: Record<TicketCategory, string> = {
  cleaning: "provider-cleaning",
  maintenance: "provider-maintenance",
};
