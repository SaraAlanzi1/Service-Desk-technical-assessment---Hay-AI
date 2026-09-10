# The Service Desk

A technical assessment project for HAY: a multi-role ticketing app for tenant-reported building issues, with SLA-tracked provider workflows and admin reporting.

## Stack

- **Frontend**: Next.js (App Router, TypeScript, Tailwind), deployed to Vercel (Hobby/free plan) — no Firebase Hosting.
- **Backend**: Firebase — Firestore, Firebase Auth, Storage. Firestore/Auth run on the free Spark plan.
- **Monorepo**: npm workspaces — `web/` (Next.js app), `functions/` (Cloud Functions), `shared/` (types + the single source of truth for SLA math).
- **Client reads and single-document writes** go through the Firestore client SDK, authorized by Security Rules (`firestore.rules`, `storage.rules`) — unchanged between local and production.
- **All ticket-state mutations** (acknowledge, pause, resume, resolve) and report generation go through a privileged, server-side execution boundary that re-validates authorization using the Firebase Admin SDK (which itself bypasses Security Rules). **Which boundary, depends on environment** — see below.

### Two execution boundaries, one set of rules

The locked design originally specified Firebase Cloud Functions Gen 2 for every mutation. Cloud Functions — at any usage level, Gen 1 or Gen 2 — require the Blaze (pay-as-you-go) billing plan to deploy at all; Blaze was explicitly ruled out for this project's production deployment. Rather than compromise the security model to fit a free tier, this project runs the identical authorization/transition logic in two places:

| | Local development | Production |
|---|---|---|
| Execution boundary | Firebase Cloud Functions Gen 2, via the emulator suite | Next.js API routes (`web/src/app/api/**/route.ts`) as Vercel Serverless Functions |
| Entry point on the client | `httpsCallable()` | `fetch()` with a Firebase ID token as a bearer header |
| Admin SDK credential | Application Default Credentials (emulator) | A Firebase service account key, stored only as a Vercel environment variable |
| Cost | Free (emulator) | Free (Vercel Hobby + Firebase Spark) |

**`functions/src/**` is untouched and still the source of truth for the local/emulator workflow** — `npm run emulators` behaves exactly as it always has. The production API routes under `web/src/app/api/` are deliberate, byte-for-byte-equivalent duplicates of that same logic (see `web/src/lib/api/ticketTransitions.ts`'s header comment), re-implemented against `verifyIdToken()` instead of the callable-functions wire protocol. Both copies:
- Enforce the identical state-machine and effective-access checks.
- Import the identical `shared/src/sla.ts` functions for every SLA/breach calculation — no SLA math is duplicated, only the auth/transition scaffolding around it.
- Never accept a client-supplied `workflowStatus`, `*By` field, or timestamp.

The Admin SDK service account credential exists **only** as the `FIREBASE_SERVICE_ACCOUNT_KEY` Vercel environment variable (Production scope) — it is never committed to git, never sent to the browser, and is read only inside `web/src/lib/firebase/admin.ts`, which is imported exclusively by server-side route handlers.

## Data model

8 top-level collections plus one subcollection:

| Collection | Notes |
|---|---|
| `Building` | 6 fixed documents. |
| `Provider` | 2 fixed documents (`provider-cleaning`, `provider-maintenance`). |
| `Tenant` | Auth-backed profile; `buildingId`/`unit` admin-provisioned only. |
| `ProviderStaff` | Auth-backed profile; `homeBuildingId` is the standing assignment, extended temporarily by `effectiveGrants` (see below). |
| `OperatorAdmin` | Auth-backed profile, global scope. |
| `Ticket` | `workflowStatus` is one of `submitted → acknowledged → paused → resolved`. `in_progress` is UI-derived, never stored. `paused → resolved` is allowed and auto-closes the open pause window. |
| `Ticket/{id}/PauseWindow` | Subcollection. One open window at a time per ticket. |
| `CoverageGrant` | Admin-issued, time-boxed (`expiresAt` mandatory) grant of a provider staff member's access to a building outside their home building. Full history preserved — never overwritten. |
| `MonthlyReport` | Persisted snapshot, generated on demand by an admin — not live-computed. |

### Effective access ("who can touch this ticket")

A provider staff member has access to a ticket if `ticket.providerId == staff.providerId` **and** (`ticket.buildingId == staff.homeBuildingId` **or** `staff.effectiveGrants[ticket.buildingId]` is present with `revokedAt == null` and `expiresAt > now`).

`ProviderStaff.effectiveGrants` is a **derived authorization index**, not the source of truth — `CoverageGrant` documents remain authoritative and are never overwritten (reissuing creates a new document; revoking sets `revokedAt` on the specific document). The index is kept consistent with `CoverageGrant` by writing both in the same atomic Firestore batch (no async Cloud Function trigger — that would open a window where a grant exists but access isn't yet active, or a revoke has landed but access isn't yet cut off). Firestore Security Rules use `getAfter()`/`get()` to enforce that both halves of the batch agree.

This exact condition is implemented identically in `firestore.rules` and in all four ticket-transition Cloud Functions (`functions/src/transitions/shared.ts`'s `hasBuildingAccess`), since Cloud Functions use the Admin SDK and bypass rules entirely — the check has to be re-enforced in code.

## SLA logic (`shared/src/sla.ts`)

- **Acknowledge clock**: 4 hours from `submittedAt` to `acknowledgedAt`. Pauses have no effect on this clock (pausing is only possible after acknowledgement).
- **Resolve clock**: 48 hours from `acknowledgedAt`, with total paused duration subtracted.
- **Breach comparison** is strictly exclusive: `elapsed > limit`, not `>=`.
- **"Breach once, breach forever"**: `Ticket.firstBreachedAt` is set the first time a transition function observes a breach, and is never cleared — even if a later pause would arithmetically "un-breach" the resolve clock.
- `avgResolveTimeMinutes` in `MonthlyReport` uses the SLA-adjusted (pause-subtracted) resolve duration.

All of this logic lives in exactly one place. Both `web/` (live countdown) and `functions/` (breach detection, resolve calculations) import the same functions — nothing is reimplemented on either side.

## Local development

Prerequisites: Node 20+, `firebase-tools` (installed globally), a `firebase login` session.

```bash
npm install
npm run build            # builds shared -> functions -> web, in that order
npm run emulators         # boots Auth/Firestore/Functions/Storage emulators
```

In a second terminal:

```bash
node functions/scripts/seed.js   # seeds Buildings, Providers, one account per role
npm run dev                       # Next.js dev server on :3000, connects to the emulators
```

`web/.env.local.example` documents the required env vars; copy it to `web/.env.local` (already gitignored) and set `NEXT_PUBLIC_USE_EMULATOR=true` for local work.

Seeded accounts (password `password123` for all): `admin@example.com`, `tenant@example.com`, `provider@example.com` (provider-cleaning, home building-1).

## Production deployment

- **GitHub**: https://github.com/SaraAlanzi1/Service-Desk-technical-assessment---Hay-AI
- **Live URL**: https://web-saralanazi.vercel.app
- **Firebase project**: `service-desk-hay` (Firestore + Auth on Spark; Cloud Functions intentionally not deployed — see above).
- Vercel project settings: Root Directory `web`, Install Command `npm install` (runs at the monorepo root so the `shared` workspace resolves), Build Command `(cd ../shared && npm run build) && npm run build`.
- Production env vars (Vercel, Production scope): the 7 `NEXT_PUBLIC_FIREBASE_*`/`NEXT_PUBLIC_USE_EMULATOR=false` values plus `FIREBASE_SERVICE_ACCOUNT_KEY` (secret).
- Firebase Storage has not been provisioned in the production project (one manual console step, never done) — ticket photo upload will fail in production; every other flow is unaffected since photo attachment is optional.
- Demo accounts (production, password `password123` for all): `admin@example.com`, `tenant@example.com`, `provider@example.com` (provider-cleaning, home building-1). Seeded via `functions/scripts/seed-production.js`, which also sets each account's role custom claim directly (idempotent — safe to re-run; see script header comment for why).

### Production smoke test results

Run against the live URL after the Cloud-Functions-to-Vercel-API-routes migration, driving the real UI (not scripts) for every step:

| Step | Result |
|---|---|
| Tenant login + submit ticket | ✅ Real client-side Firestore write, validated by Security Rules |
| Provider login + queue view | ✅ Ticket visible, correctly scoped by providerId + buildingId |
| Acknowledge (`/api/acknowledge`) | ✅ `submitted` → `acknowledged`, resolve clock started |
| Pause for parts (`/api/pause`) | ✅ `acknowledged` → `paused`, PauseWindow created with correct reason/timestamps |
| Resume (`/api/resume`) | ✅ `paused` → `acknowledged`, resolve clock correctly pause-adjusted |
| Resolve (`/api/resolve`) | ✅ `acknowledged` → `resolved` |
| Admin: generate monthly report (`/api/reports/generate`) | ✅ 1 total, 0 open, 0 breached, avg resolve time correctly computed |
| Admin: stats view | ✅ Live Firestore read reflects the resolved ticket correctly |
| Negative test: no bearer token → `/api/acknowledge` | ✅ `401 Missing bearer token.` |
| Negative test: valid tenant token → `/api/acknowledge` | ✅ `403 Only provider staff can perform ticket transitions.` |

All ten steps passed on the first attempt after the migration.

## Manual verification scripts (`functions/scripts/`)

There is no automated test framework (Jest/Vitest) in this project — verification has been done via targeted Node scripts run against the emulator, plus manual UI walkthroughs of the full flow (login → submit → acknowledge → pause → resume → resolve → reports/stats) for all three roles:

- `test-coverage-grant.js` — CoverageGrant issuance/revocation/reissue via atomic batches, plus forged-pointer and unauthorized-write denial cases, exercised directly against Security Rules.
- `test-effective-access.js` — the same effective-access condition exercised through the actual Cloud Functions (not just rules): full acknowledge→pause→resume→resolve regression, cross-provider denial, cross-building denial, non-provider-role denial.
- `verify-coverage-grant-state.js` — Admin SDK read-back of CoverageGrant/effectiveGrants state for manual inspection.

## Known limitations

These are deliberate scope decisions, not defects, carried forward from the locked design conversation:

- **No admin provisioning UI.** `createTenant` and `createProviderStaff` are real, working, admin-gated Cloud Functions (emulator only — not migrated to a production API route, since nothing in the UI calls them), and CoverageGrant issuance/revocation logic exists in `web/src/lib/coverageGrants.ts` — but nothing in the app UI calls any of them yet. Account/grant provisioning, in both local and production, is done via an Admin-SDK script.
- **Ticket photos are uploaded but never displayed.** The tenant ticket-creation flow uploads to Storage and stores URLs on `Ticket.photos`, but no page (tenant or provider) renders them. `storage.rules` scopes photo read access to the uploading tenant only, pending this.
- **`PauseWindow.requestedBy`** displays a truncated raw UID on the provider queue, not a name — resolving this means either broadening `ProviderStaff` read access beyond what's locked, or denormalizing a name onto `PauseWindow` (a field not in the locked schema). Neither call has been made.
- **No automated test suite** — see above.
- **`web`'s `lint` script** (`next lint`) cannot currently run — `eslint` isn't installed as a dependency and no config exists.

## Security & privacy

See [`SECURITY.md`](./SECURITY.md).
