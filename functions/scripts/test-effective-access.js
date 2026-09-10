// Tests the "effective access" condition through the actual Cloud Functions
// path (acknowledge/openPause/resumeTicket/resolveTicket), not just rules —
// per the requirement that Security Rules and all four transition functions
// enforce the identical homeBuildingId UNION active-effectiveGrants
// condition. Also covers cross-provider and cross-building denial, and the
// full acknowledge -> pause -> resume -> resolve regression using a ticket
// whose access comes from effectiveGrants rather than homeBuildingId.
const { initializeApp } = require("firebase/app");
const {
  getAuth,
  connectAuthEmulator,
  signInWithEmailAndPassword,
  signOut,
} = require("firebase/auth");
const {
  getFirestore,
  connectFirestoreEmulator,
  doc,
  collection,
  getDoc,
  addDoc,
  serverTimestamp,
  Timestamp,
  writeBatch,
} = require("firebase/firestore");
const { getFunctions, connectFunctionsEmulator, httpsCallable } = require("firebase/functions");

const app = initializeApp({ projectId: "service-desk-hay", apiKey: "demo-key" });
const auth = getAuth(app);
connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
const db = getFirestore(app);
connectFirestoreEmulator(db, "127.0.0.1", 8080);
const fns = getFunctions(app, "us-central1");
connectFunctionsEmulator(fns, "127.0.0.1", 5001);

async function as(email, fn) {
  await signInWithEmailAndPassword(auth, email, "password123");
  try {
    return await fn(auth.currentUser.uid);
  } finally {
    await signOut(auth);
  }
}

async function expectOk(label, fn) {
  try {
    const result = await fn();
    console.log(`PASS (${label}): call succeeded`);
    return result;
  } catch (e) {
    console.log(`FAIL (${label}): call denied unexpectedly — ${e.code || e.message}`);
    throw e;
  }
}

async function expectDenied(label, fn) {
  try {
    await fn();
    console.log(`FAIL (${label}): call succeeded but should have been denied`);
  } catch (e) {
    console.log(`PASS (${label}): denied — ${e.code || e.message}`);
  }
}

function issueBatch(adminUid, providerStaffId, buildingId, expiresAtMs) {
  const grantRef = doc(collection(db, "CoverageGrant"));
  const staffRef = doc(db, "ProviderStaff", providerStaffId);
  const expiresAt = Timestamp.fromMillis(expiresAtMs);
  const batch = writeBatch(db);
  batch.set(grantRef, {
    providerStaffId,
    buildingId,
    grantedBy: adminUid,
    grantedAt: serverTimestamp(),
    expiresAt,
    revokedAt: null,
  });
  batch.update(staffRef, {
    [`effectiveGrants.${buildingId}`]: { grantId: grantRef.id, expiresAt, revokedAt: null },
  });
  return { batch, grantRef };
}

async function submitTicket(buildingId, unit, category) {
  const ref = await addDoc(collection(db, "Ticket"), {
    buildingId,
    unit,
    tenantId: auth.currentUser.uid,
    providerId: category === "cleaning" ? "provider-cleaning" : "provider-maintenance",
    category,
    title: "Test ticket",
    description: "Effective-access regression test ticket.",
    photos: [],
    priority: "normal",
    workflowStatus: "submitted",
    submittedAt: serverTimestamp(),
    acknowledgedAt: null,
    acknowledgedBy: null,
    resolvedAt: null,
    resolvedBy: null,
    firstBreachedAt: null,
  });
  return ref.id;
}

async function main() {
  const PROVIDER_UID = process.argv[2]; // provider-cleaning, home=building-1
  const OTHER_PROVIDER_UID = process.argv[3]; // provider-maintenance, home=building-2

  // ===== Setup: grant PROVIDER_UID (home=building-1) active access to
  // building-2, which is NOT their home building. =====
  await as("admin@example.com", async (adminUid) => {
    const { batch } = issueBatch(adminUid, PROVIDER_UID, "building-2", Date.now() + 2 * 60 * 60 * 1000);
    await expectOk("grant PROVIDER_UID access to building-2 (batch)", () => batch.commit());
  });

  // ===== Full regression: acknowledge -> pause -> resume -> resolve, access
  // via effectiveGrants (not homeBuildingId). =====
  let ticketB2;
  await as("tenant2@example.com", async () => {
    ticketB2 = await submitTicket("building-2", "201", "cleaning");
    console.log("created ticketB2 =", ticketB2, "(building-2, provider-cleaning)");
  });

  await as("provider@example.com", async () => {
    const acknowledgeFn = httpsCallable(fns, "acknowledge");
    await expectOk("acknowledge via effectiveGrants (not homeBuildingId)", () =>
      acknowledgeFn({ ticketId: ticketB2 }),
    );
  });
  await as("admin@example.com", async () => {
    const snap = await getDoc(doc(db, "Ticket", ticketB2));
    console.log("  -> workflowStatus =", snap.data().workflowStatus);
  });

  await as("provider@example.com", async () => {
    const openPauseFn = httpsCallable(fns, "openPause");
    await expectOk("openPause via effectiveGrants", () =>
      openPauseFn({
        ticketId: ticketB2,
        reason: "waiting on parts",
        estimatedResumeAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      }),
    );
  });
  await as("admin@example.com", async () => {
    const snap = await getDoc(doc(db, "Ticket", ticketB2));
    console.log("  -> workflowStatus =", snap.data().workflowStatus);
  });

  await as("provider@example.com", async () => {
    const resumeFn = httpsCallable(fns, "resumeTicket");
    await expectOk("resumeTicket via effectiveGrants", () => resumeFn({ ticketId: ticketB2 }));
  });
  await as("admin@example.com", async () => {
    const snap = await getDoc(doc(db, "Ticket", ticketB2));
    console.log("  -> workflowStatus =", snap.data().workflowStatus);
  });

  await as("provider@example.com", async () => {
    const resolveFn = httpsCallable(fns, "resolveTicket");
    await expectOk("resolveTicket via effectiveGrants", () => resolveFn({ ticketId: ticketB2 }));
  });
  await as("admin@example.com", async () => {
    const snap = await getDoc(doc(db, "Ticket", ticketB2));
    console.log("  -> workflowStatus =", snap.data().workflowStatus);
  });

  // ===== Cross-provider denial: OTHER_PROVIDER_UID's home building IS
  // building-2 (so building access alone would pass) but its providerId is
  // provider-maintenance, not provider-cleaning — must still be denied. =====
  let ticketB2b;
  await as("tenant2@example.com", async () => {
    ticketB2b = await submitTicket("building-2", "201", "cleaning");
    console.log("created ticketB2b =", ticketB2b, "(building-2, provider-cleaning)");
  });
  await as("provider2@example.com", async () => {
    const acknowledgeFn = httpsCallable(fns, "acknowledge");
    await expectDenied("cross-provider: denied despite matching home building", () =>
      acknowledgeFn({ ticketId: ticketB2b }),
    );
  });

  // ===== Cross-building denial: PROVIDER_UID's providerId (provider-cleaning)
  // matches, but it has neither homeBuildingId nor any grant for building-3
  // — must be denied despite the providerId match. =====
  let ticketB3;
  await as("tenant3@example.com", async () => {
    ticketB3 = await submitTicket("building-3", "301", "cleaning");
    console.log("created ticketB3 =", ticketB3, "(building-3, provider-cleaning)");
  });
  await as("provider@example.com", async () => {
    const acknowledgeFn = httpsCallable(fns, "acknowledge");
    await expectDenied("cross-building: denied — no home/grant for building-3", () =>
      acknowledgeFn({ ticketId: ticketB3 }),
    );
  });

  // ===== Unauthorized access via Cloud Functions generally: a signed-in
  // tenant (not provider staff at all) calling a transition function. =====
  await as("tenant2@example.com", async () => {
    const acknowledgeFn = httpsCallable(fns, "acknowledge");
    await expectDenied("non-provider role denied by requireProviderStaff", () =>
      acknowledgeFn({ ticketId: ticketB2b }),
    );
  });

  console.log("done");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
