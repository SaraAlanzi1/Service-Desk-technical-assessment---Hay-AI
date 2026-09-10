# Security & Privacy Posture

This document describes what's actually implemented — not an aspirational policy. It reflects the state of the code at commit `0b99ecf` and after.

## Authorization boundary

Two enforcement paths, per the locked design:

1. **Firestore Security Rules** (`firestore.rules`) guard direct client reads and a small set of single-document client writes: `Ticket` creation (tenant only), `CoverageGrant` creation/revocation (admin only), and narrow self-service profile edits (name/email only). Identical in local and production — this half never changed.
2. **A privileged, server-side execution boundary** (Admin SDK, which bypasses Security Rules entirely) owns every ticket state transition — `acknowledge`, `openPause`, `resumeTicket`, `resolveTicket` — and `generateMonthlyReport`. Because the Admin SDK bypasses rules, **every one of these handlers re-validates the caller's role and effective access in code**, wrapped in a Firestore transaction. Nothing about `Ticket.workflowStatus` or its accountability fields (`acknowledgedAt`/`By`, `resolvedAt`/`By`) is ever writable directly by a client — `allow update: if false` on `Ticket` is absolute.

**This boundary runs as two independent, logic-identical implementations**, because Firebase Cloud Functions (any generation) require the Blaze billing plan to deploy at all, and this project's production deployment is constrained to free-tier services only:

- **Local/emulator**: Firebase Cloud Functions Gen 2, exactly as originally designed — `functions/src/transitions/*.ts`, `functions/src/reports/generateMonthlyReport.ts`. Untouched by the production migration below.
- **Production**: Next.js Route Handlers deployed as Vercel Serverless Functions — `web/src/app/api/{acknowledge,pause,resume,resolve,reports/generate}/route.ts`. Each one verifies a Firebase ID token (`Authorization: Bearer <token>`) server-side via `adminAuth.verifyIdToken()`, re-implements the identical role check, calls the identical `shared/src/sla.ts` functions, and runs the identical Firestore transaction shape as its Cloud Functions counterpart. `web/src/lib/api/ticketTransitions.ts` carries the file-level comment establishing it as a deliberate, tracked duplicate of `functions/src/transitions/shared.ts` — any future authorization change must be applied to both.
- The Admin SDK credential this boundary runs as (a Firebase service account key) is stored **only** as the `FIREBASE_SERVICE_ACCOUNT_KEY` Vercel environment variable, scoped to Production. It is read exactly once, lazily, inside `web/src/lib/firebase/admin.ts` — a module never imported by any `"use client"` file, and therefore never bundled into browser-shipped code. It is not committed to git (`.gitignore` excludes all `.env*` files; the key was never written to a file inside the repo at any point).
- The client-side call path changed from `httpsCallable()` to an authenticated `fetch()` (`web/src/lib/api.ts`'s `callMutation()`), but only when not running against the emulator — the emulator path still uses `httpsCallable()` unchanged. No page's *behavior* changed: the same function names, the same request payloads, the same error surface to the user.

## Roles and identity

- Three roles: `tenant`, `providerStaff`, `operatorAdmin`, held as a custom claim (`request.auth.token.role`) on the Firebase Auth user — not read from a Firestore document at request time (avoids an extra read on every rule evaluation).
- The claim is set by a Firestore-triggered Cloud Function (`functions/src/triggers/assignRoleClaim.ts`) the moment the corresponding profile document (`Tenant`, `ProviderStaff`, `OperatorAdmin`) is created. Profile creation itself is admin-gated (`createTenant`, `createProviderStaff` Cloud Functions check `request.auth.token.role == 'operatorAdmin'`) or done via the Admin SDK directly for the bootstrap admin.
- No account can self-register with an elevated role. `allow create: if false` on all three profile collections in `firestore.rules` — the only path to a new profile document is the admin-gated callables or Admin SDK.

## Effective access model

A provider staff member can act on a ticket only if **both** hold:
- `ticket.providerId == staff.providerId` (never editable after ticket creation — set once from the category→provider mapping at submission time).
- `ticket.buildingId == staff.homeBuildingId`, **or** an active entry in `staff.effectiveGrants[buildingId]` (`revokedAt == null` and `expiresAt > now`).

`effectiveGrants` is a derived index kept consistent with the authoritative `CoverageGrant` collection via same-batch atomic writes (see README for the full rationale). Security Rules cross-validate both halves of every such write using `getAfter()`, so a client cannot forge a grant pointer to a nonexistent or mismatched `CoverageGrant` document, and cannot silently drop the required pointer update — this was verified directly (`functions/scripts/test-coverage-grant.js` includes forged-pointer and no-pointer-update denial cases). The identical condition is implemented in Cloud Functions (`hasBuildingAccess` in `functions/src/transitions/shared.ts`), verified via `functions/scripts/test-effective-access.js` (cross-provider denial, cross-building denial, and the full transition regression using grant-based rather than home-building access).

## Data isolation

- A tenant can read only their own `Ticket` documents (`tenantId == request.auth.uid`) and only their own profile.
- A provider staff member can read only tickets matching their `providerId` and effective building access, and only their own `ProviderStaff` profile (not a colleague's — this is why `PauseWindow.requestedBy` renders a raw UID rather than a name on the queue page; see README known limitations).
- `CoverageGrant` has `allow read: if false` for everyone, including admins — it's write-only from the client's perspective by design; admins must track `grantId`/`providerStaffId`/`buildingId` out of band when revoking (a known limitation, not a bug).
- `MonthlyReport` is readable by admins (all) and by provider staff scoped to their own `providerId`.
- Storage: ticket photo uploads are scoped to `ticketPhotos/{uploaderUid}/...` with `allow read, write: if request.auth.uid == uid` — only the uploading tenant can read or write their own photos today (providers/admins cannot read them yet — see README).

## Server-controlled fields

Never trusted from the client, in either enforcement path:
- All timestamps (`serverTimestamp()` client-side where rules allow client writes, `Timestamp.now()` server-side in every Cloud Function).
- Every `*By` accountability field (`acknowledgedBy`, `resolvedBy`, `grantedBy`, PauseWindow's `requestedBy`/`resumedBy`) is set from `request.auth.uid` / `context.auth.uid`, never from client-supplied data.
- `Ticket.providerId` is set once at creation from the category→provider mapping and is immutable afterward (enforced by `Ticket`'s `allow update: if false`).
- `Tenant.buildingId`/`unit` and `ProviderStaff.homeBuildingId`/`providerId` are admin-provisioned only; a user's own self-update rule (`selfUpdateOnlyChangesNameAndEmail`) explicitly excludes them.

## Data handled

Names, emails, unit numbers, building/provider identifiers, ticket text/category/priority, and uploaded photo URLs. No payment data, no government ID numbers, no health data. Firebase Auth handles password storage/hashing — this app never sees or stores a raw password beyond the moment of a `signInWithEmailAndPassword`/`createUser` call, which goes straight to the Auth SDK.

## What has and hasn't been verified

- Every authorization path above has been exercised against the **Firestore/Auth/Functions emulator**, both via targeted Node scripts (`functions/scripts/test-*.js`) and manual multi-role UI walkthroughs, including explicit unauthorized-access attempts (cross-provider, cross-building, non-admin, non-provider, forged data) — all correctly denied.
- The **production** deployment (real Firestore/Auth on Spark, real Vercel-hosted API routes) has been smoke-tested end to end: tenant submission → provider acknowledge → pause/resume → resolve → admin report generation, plus at least one negative-access case, all against the live URL. See README's "Production deployment" section for the exact results.
- Firebase Storage has never been provisioned in the production project (a one-time manual console step, not done) — photo upload will fail in production; nothing else depends on it.
- No penetration testing, dependency vulnerability scanning, or rate-limiting/abuse-prevention has been done. Out of scope for this assessment as locked.
