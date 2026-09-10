// Seeds demo accounts directly into PRODUCTION Firebase (real Firestore/Auth
// on the Spark plan) — never against the emulator.
//
// Production has no deployed Cloud Function triggers (see README's "Two
// execution boundaries" section: Cloud Functions require the Blaze plan,
// which this project does not use). The onTenantCreated/onProviderStaffCreated/
// onOperatorAdminCreated triggers that normally assign a user's role custom
// claim never run in production, so this script sets the claim directly,
// right after creating each profile document, replicating exactly what
// those triggers do locally.
//
// Run with (PowerShell), pointing at your own downloaded service account
// key file — never commit that file or paste its contents anywhere:
//   $env:GOOGLE_APPLICATION_CREDENTIALS = "C:\path\to\your-key.json"
//   node functions/scripts/seed-production.js
const admin = require("firebase-admin");

admin.initializeApp({ projectId: "service-desk-hay" });

const auth = admin.auth();
const db = admin.firestore();

const BUILDINGS = [
  { id: "building-1", name: "Building One", address: "100 Main St" },
  { id: "building-2", name: "Building Two", address: "200 Main St" },
  { id: "building-3", name: "Building Three", address: "300 Main St" },
  { id: "building-4", name: "Building Four", address: "400 Main St" },
  { id: "building-5", name: "Building Five", address: "500 Main St" },
  { id: "building-6", name: "Building Six", address: "600 Main St" },
];

const PROVIDERS = [
  { id: "provider-cleaning", name: "Cleaning Provider", serviceType: "cleaning" },
  { id: "provider-maintenance", name: "Maintenance Provider", serviceType: "maintenance" },
];

async function seedReferenceData() {
  for (const building of BUILDINGS) {
    const { id, ...fields } = building;
    await db.collection("Building").doc(id).set(fields, { merge: true });
  }
  for (const provider of PROVIDERS) {
    const { id, ...fields } = provider;
    await db.collection("Provider").doc(id).set(fields, { merge: true });
  }
  console.log(`Seeded ${BUILDINGS.length} Building docs and ${PROVIDERS.length} Provider docs.`);
}

async function seedUser({ email, password, name, collection, role, profile }) {
  let userRecord;
  try {
    userRecord = await auth.createUser({ email, password, displayName: name });
  } catch (err) {
    if (err.code === "auth/email-already-exists") {
      userRecord = await auth.getUserByEmail(email);
      console.log(`  (auth user already existed: ${email})`);
    } else {
      throw err;
    }
  }
  await db.collection(collection).doc(userRecord.uid).set({ name, email, ...profile });
  await auth.setCustomUserClaims(userRecord.uid, { role });
  console.log(`Seeded ${collection} ${email} (uid: ${userRecord.uid}, role claim: ${role})`);
  return userRecord.uid;
}

async function main() {
  await seedReferenceData();

  await seedUser({
    email: "admin@example.com",
    password: "password123",
    name: "Demo Admin",
    collection: "OperatorAdmin",
    role: "operatorAdmin",
    profile: {},
  });

  await seedUser({
    email: "tenant@example.com",
    password: "password123",
    name: "Demo Tenant",
    collection: "Tenant",
    role: "tenant",
    profile: { buildingId: "building-1", unit: "101" },
  });

  await seedUser({
    email: "provider@example.com",
    password: "password123",
    name: "Demo Provider Staff",
    collection: "ProviderStaff",
    role: "providerStaff",
    profile: { providerId: "provider-cleaning", homeBuildingId: "building-1" },
  });

  console.log("Done.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
