// Seeds the 6 Building docs, the 2 Provider docs, and one OperatorAdmin +
// one Tenant + one ProviderStaff account into the running emulator suite.
// Run with the emulators already up: `npm run seed --workspace=functions`.
//
// Building/Provider doc IDs here are the same literal IDs hardcoded in
// firestore.rules (categoryProviderId()) and shared/src/providerMapping.ts
// (CATEGORY_TO_PROVIDER_ID) — keep all three in sync if they ever change.
const admin = require("firebase-admin");

process.env.FIRESTORE_EMULATOR_HOST =
  process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST =
  process.env.FIREBASE_AUTH_EMULATOR_HOST || "127.0.0.1:9099";

admin.initializeApp({ projectId: "service-desk-hay" });

const auth = admin.auth();
const db = admin.firestore();

async function seedUser({ email, password, name, collection, profile }) {
  const userRecord = await auth.createUser({
    email,
    password,
    displayName: name,
  });
  await db
    .collection(collection)
    .doc(userRecord.uid)
    .set({ name, email, ...profile });
  console.log(`Seeded ${collection} ${email} (uid: ${userRecord.uid})`);
  return userRecord.uid;
}

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
    await db.collection("Building").doc(id).set(fields);
  }
  console.log(`Seeded ${BUILDINGS.length} Building docs.`);

  for (const provider of PROVIDERS) {
    const { id, ...fields } = provider;
    await db.collection("Provider").doc(id).set(fields);
  }
  console.log(`Seeded ${PROVIDERS.length} Provider docs.`);
}

async function main() {
  await seedReferenceData();

  await seedUser({
    email: "admin@example.com",
    password: "password123",
    name: "Seed Admin",
    collection: "OperatorAdmin",
    profile: {},
  });

  await seedUser({
    email: "tenant@example.com",
    password: "password123",
    name: "Seed Tenant",
    collection: "Tenant",
    profile: { buildingId: "building-1", unit: "101" },
  });

  await seedUser({
    email: "provider@example.com",
    password: "password123",
    name: "Seed Provider Staff",
    collection: "ProviderStaff",
    profile: { providerId: "provider-cleaning", homeBuildingId: "building-1" },
  });

  // Give the onDocumentCreated triggers a moment to set role claims before
  // this process exits.
  console.log("Waiting for role-claim triggers to fire...");
  await new Promise((resolve) => setTimeout(resolve, 2000));
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
