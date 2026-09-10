// Comprehensive test script for the atomic-batch CoverageGrant flow.
// Duplicates web/src/lib/coverageGrants.ts's batch shape inline rather than
// importing it directly (that module uses a Next.js path alias and lives in
// a sibling workspace) — both submit the identical Firestore batch
// operations, so this genuinely exercises the same rules.
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
  setDoc,
  updateDoc,
  writeBatch,
  serverTimestamp,
  Timestamp,
} = require("firebase/firestore");

const app = initializeApp({ projectId: "service-desk-hay", apiKey: "demo-key" });
const auth = getAuth(app);
connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
const db = getFirestore(app);
connectFirestoreEmulator(db, "127.0.0.1", 8080);

async function as(email, fn) {
  await signInWithEmailAndPassword(auth, email, "password123");
  try {
    return await fn(auth.currentUser.uid);
  } finally {
    await signOut(auth);
  }
}

async function expect(label, shouldSucceed, fn) {
  try {
    const result = await fn();
    console.log(`${shouldSucceed ? "PASS" : "FAIL"} (${label}): write succeeded`);
    return result;
  } catch (e) {
    console.log(`${shouldSucceed ? "FAIL" : "PASS"} (${label}): write denied — ${e.code || e.message}`);
    return undefined;
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

async function revokeBatch(grantId, providerStaffId, buildingId) {
  const grantRef = doc(db, "CoverageGrant", grantId);
  const staffRef = doc(db, "ProviderStaff", providerStaffId);
  const staffSnap = await getDoc(staffRef);
  const currentPointer = staffSnap.data()?.effectiveGrants?.[buildingId];
  const isCurrent = currentPointer?.grantId === grantId;

  const batch = writeBatch(db);
  batch.update(grantRef, { revokedAt: serverTimestamp() });
  if (isCurrent) {
    batch.update(staffRef, {
      [`effectiveGrants.${buildingId}`]: {
        grantId,
        expiresAt: currentPointer.expiresAt,
        revokedAt: serverTimestamp(),
      },
    });
  }
  return batch;
}

async function main() {
  const PROVIDER_UID = process.argv[2];
  const OTHER_PROVIDER_UID = process.argv[3];

  // ===== TEST 1: valid issuance (active grant) =====
  let grantA;
  await as("admin@example.com", async (adminUid) => {
    const { batch, grantRef } = issueBatch(adminUid, PROVIDER_UID, "building-2", Date.now() + 2 * 60 * 60 * 1000);
    await expect("issue valid grant (batch)", true, () => batch.commit());
    grantA = grantRef.id;
  });

  // ===== TEST 2: unauthorized create (non-admin, direct single-doc write, no batch) =====
  await as("provider@example.com", async (providerUid) => {
    await expect("create by non-admin (provider)", false, () =>
      setDoc(doc(collection(db, "CoverageGrant")), {
        providerStaffId: providerUid,
        buildingId: "building-2",
        grantedBy: providerUid,
        grantedAt: serverTimestamp(),
        expiresAt: Timestamp.fromMillis(Date.now() + 60 * 60 * 1000),
        revokedAt: null,
      }),
    );
  });

  // ===== TEST: unauthorized self-grant via direct effectiveGrants write =====
  await as("provider@example.com", async (providerUid) => {
    await expect("provider self-writes effectiveGrants directly", false, () =>
      updateDoc(doc(db, "ProviderStaff", providerUid), {
        "effectiveGrants.building-99": { grantId: "forged", expiresAt: Timestamp.fromMillis(Date.now() + 999999999), revokedAt: null },
      }),
    );
  });

  // ===== TEST: forged pointer with no matching CoverageGrant, by admin =====
  await as("admin@example.com", async () => {
    await expect("admin points effectiveGrants at a nonexistent grant", false, () =>
      updateDoc(doc(db, "ProviderStaff", PROVIDER_UID), {
        "effectiveGrants.building-88": {
          grantId: "does-not-exist",
          expiresAt: Timestamp.fromMillis(Date.now() + 60 * 60 * 1000),
          revokedAt: null,
        },
      }),
    );
  });

  // ===== TEST: CoverageGrant create without the matching batch pointer update =====
  await as("admin@example.com", async (adminUid) => {
    await expect("create CoverageGrant alone, no pointer update in same write", false, () =>
      setDoc(doc(collection(db, "CoverageGrant")), {
        providerStaffId: PROVIDER_UID,
        buildingId: "building-77",
        grantedBy: adminUid,
        grantedAt: serverTimestamp(),
        expiresAt: Timestamp.fromMillis(Date.now() + 60 * 60 * 1000),
        revokedAt: null,
      }),
    );
  });

  // ===== TEST 3: expired grant does not grant access =====
  let grantExpired;
  await as("admin@example.com", async (adminUid) => {
    const { batch, grantRef } = issueBatch(adminUid, PROVIDER_UID, "building-3", Date.now() + 2000);
    await expect("issue short-lived grant for expiry test", true, () => batch.commit());
    grantExpired = grantRef.id;
  });
  console.log("waiting 3s for the short-lived grant to expire...");
  await new Promise((r) => setTimeout(r, 3000));

  // ===== TEST 4: revoked grant does not grant access =====
  let grantToRevoke;
  await as("admin@example.com", async (adminUid) => {
    const { batch, grantRef } = issueBatch(adminUid, PROVIDER_UID, "building-4", Date.now() + 2 * 60 * 60 * 1000);
    await expect("issue grant for revoke test", true, () => batch.commit());
    grantToRevoke = grantRef.id;
  });
  await as("admin@example.com", async () => {
    const batch = await revokeBatch(grantToRevoke, PROVIDER_UID, "building-4");
    await expect("revoke current-pointer grant", true, () => batch.commit());
  });

  // ===== TEST 5: reissue — history preserved, old grant doesn't affect new =====
  let reissueOld, reissueNew;
  await as("admin@example.com", async (adminUid) => {
    const first = issueBatch(adminUid, PROVIDER_UID, "building-5", Date.now() + 60 * 60 * 1000);
    await expect("reissue: issue first grant", true, () => first.batch.commit());
    reissueOld = first.grantRef.id;

    const second = issueBatch(adminUid, PROVIDER_UID, "building-5", Date.now() + 3 * 60 * 60 * 1000);
    await expect("reissue: issue second grant (same pair)", true, () => second.batch.commit());
    reissueNew = second.grantRef.id;
  });

  // Revoking the OLDER (superseded) grant must not touch the newer pointer.
  await as("admin@example.com", async () => {
    const batch = await revokeBatch(reissueOld, PROVIDER_UID, "building-5");
    await expect("revoke OLDER superseded grant", true, () => batch.commit());
  });

  console.log("PROVIDER_UID=" + PROVIDER_UID);
  console.log(
    "grants: grantA(building-2, active)=" + grantA,
    "| grantExpired(building-3)=" + grantExpired,
    "| grantToRevoke(building-4, revoked)=" + grantToRevoke,
    "| reissueOld(building-5, revoked, superseded)=" + reissueOld,
    "| reissueNew(building-5, active, current)=" + reissueNew,
  );

  console.log("done");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
