// Ad-hoc: seed a second Tenant (building-2) so a ticket can be created
// outside provider@example.com's home building, to test effectiveGrants-based
// (not homeBuildingId-based) access through the Cloud Functions.
const admin = require("firebase-admin");

process.env.FIRESTORE_EMULATOR_HOST =
  process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST =
  process.env.FIREBASE_AUTH_EMULATOR_HOST || "127.0.0.1:9099";

admin.initializeApp({ projectId: "service-desk-hay" });
const auth = admin.auth();
const db = admin.firestore();

async function main() {
  const userRecord3 = await auth.createUser({
    email: "tenant3@example.com",
    password: "password123",
    displayName: "Seed Tenant Three",
  });
  await db.collection("Tenant").doc(userRecord3.uid).set({
    name: "Seed Tenant Three",
    email: "tenant3@example.com",
    buildingId: "building-3",
    unit: "301",
  });
  console.log(`Seeded Tenant tenant3@example.com (uid: ${userRecord3.uid})`);
  await new Promise((r) => setTimeout(r, 1000));
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
