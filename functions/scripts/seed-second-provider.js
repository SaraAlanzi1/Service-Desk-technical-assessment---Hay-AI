// Ad-hoc: seed a second ProviderStaff account (different provider, different
// home building) for cross-provider / cross-building CoverageGrant tests.
// Not part of the repo's own seed.js — scratch-only, this session's emulator run.
const admin = require("firebase-admin");

process.env.FIRESTORE_EMULATOR_HOST =
  process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST =
  process.env.FIREBASE_AUTH_EMULATOR_HOST || "127.0.0.1:9099";

admin.initializeApp({ projectId: "service-desk-hay" });
const auth = admin.auth();
const db = admin.firestore();

async function main() {
  const userRecord = await auth.createUser({
    email: "provider2@example.com",
    password: "password123",
    displayName: "Seed Provider Staff Two",
  });
  await db.collection("ProviderStaff").doc(userRecord.uid).set({
    name: "Seed Provider Staff Two",
    email: "provider2@example.com",
    providerId: "provider-maintenance",
    homeBuildingId: "building-2",
  });
  console.log(`Seeded ProviderStaff provider2@example.com (uid: ${userRecord.uid})`);
  await new Promise((r) => setTimeout(r, 2000));
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
