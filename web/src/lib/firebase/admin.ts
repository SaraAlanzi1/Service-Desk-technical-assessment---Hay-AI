import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

// Server-only. This is the Vercel serverless execution boundary for
// production — the zero-cost replacement for Firebase Cloud Functions Gen 2
// (which cannot deploy on the free Spark plan; Blaze is explicitly out of
// scope for this project). Only ever imported by route handlers under
// src/app/api/**/route.ts, which Next.js never bundles into client code —
// do not import this from any "use client" file.
//
// The service account key is read from an env var, never committed. See
// SECURITY.md for exactly how it's provisioned.
//
// Lazily initialized (not at module load) so `next build`'s page-data
// collection step — which imports every route module regardless of whether
// a request is ever made — doesn't require this env var to be present just
// to build. It's only actually needed when a request handler runs.
let cachedApp: App | null = null;

function getAdminApp(): App {
  if (cachedApp) return cachedApp;
  if (getApps().length) {
    cachedApp = getApps()[0]!;
    return cachedApp;
  }

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (!raw) {
    throw new Error(
      "FIREBASE_SERVICE_ACCOUNT_KEY is not set. This is required for every /api/* route handler in production.",
    );
  }
  const serviceAccount = JSON.parse(raw);
  cachedApp = initializeApp({ credential: cert(serviceAccount) });
  return cachedApp;
}

export function getAdminAuth(): Auth {
  return getAuth(getAdminApp());
}

export function getAdminDb(): Firestore {
  return getFirestore(getAdminApp());
}
