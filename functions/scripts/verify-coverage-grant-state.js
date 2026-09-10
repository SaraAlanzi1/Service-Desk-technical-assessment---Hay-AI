// Admin SDK verification of on-disk state after test-coverage-grant.js —
// never trust client-reported PASS/FAIL alone; confirm the actual documents.
const admin = require("firebase-admin");
process.env.FIRESTORE_EMULATOR_HOST =
  process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080";
admin.initializeApp({ projectId: "service-desk-hay" });
const db = admin.firestore();

async function main() {
  const providerUid = process.argv[2];
  const staffSnap = await db.collection("ProviderStaff").doc(providerUid).get();
  console.log("ProviderStaff.effectiveGrants:", JSON.stringify(staffSnap.data().effectiveGrants, null, 2));

  const grantsSnap = await db
    .collection("CoverageGrant")
    .where("providerStaffId", "==", providerUid)
    .get();
  console.log(`\nAll CoverageGrant docs for ${providerUid} (${grantsSnap.size} total):`);
  grantsSnap.forEach((d) => {
    const data = d.data();
    console.log(`  ${d.id}: building=${data.buildingId} expiresAt=${data.expiresAt.toDate().toISOString()} revokedAt=${data.revokedAt ? data.revokedAt.toDate().toISOString() : "null"}`);
  });
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
