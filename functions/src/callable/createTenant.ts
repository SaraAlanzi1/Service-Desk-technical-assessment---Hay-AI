import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

interface CreateTenantRequest {
  name: string;
  email: string;
  password: string;
  buildingId: string;
  unit: string;
}

function isCreateTenantRequest(data: unknown): data is CreateTenantRequest {
  if (typeof data !== "object" || data === null) return false;
  const d = data as Record<string, unknown>;
  return (
    typeof d.name === "string" &&
    typeof d.email === "string" &&
    typeof d.password === "string" &&
    typeof d.buildingId === "string" &&
    typeof d.unit === "string"
  );
}

// Tenants cannot self-register (§ Milestone 1 provisioning). Only an
// OperatorAdmin may call this. "Atomic" here means best-effort: the Auth
// user is created first, and if the Firestore profile write fails, the Auth
// user is deleted so we never leave an orphaned account with no profile and
// no role claim. The role claim itself is set asynchronously by the
// onTenantCreated trigger, not by this function.
export const createTenant = onCall(async (request) => {
  if (request.auth?.token?.role !== "operatorAdmin") {
    throw new HttpsError(
      "permission-denied",
      "Only operator admins can create tenant accounts.",
    );
  }

  if (!isCreateTenantRequest(request.data)) {
    throw new HttpsError(
      "invalid-argument",
      "name, email, password, buildingId, and unit are required.",
    );
  }
  const { name, email, password, buildingId, unit } = request.data;

  const userRecord = await getAuth().createUser({
    email,
    password,
    displayName: name,
  });

  try {
    await getFirestore().collection("Tenant").doc(userRecord.uid).set({
      name,
      email,
      buildingId,
      unit,
    });
  } catch (err) {
    await getAuth().deleteUser(userRecord.uid);
    throw new HttpsError(
      "internal",
      "Failed to create tenant profile; rolled back the auth user.",
    );
  }

  return { uid: userRecord.uid };
});
