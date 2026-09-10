import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

interface CreateProviderStaffRequest {
  name: string;
  email: string;
  password: string;
  providerId: string;
  homeBuildingId: string;
}

function isCreateProviderStaffRequest(
  data: unknown,
): data is CreateProviderStaffRequest {
  if (typeof data !== "object" || data === null) return false;
  const d = data as Record<string, unknown>;
  return (
    typeof d.name === "string" &&
    typeof d.email === "string" &&
    typeof d.password === "string" &&
    typeof d.providerId === "string" &&
    typeof d.homeBuildingId === "string"
  );
}

// Mirrors createTenant.ts: admin-only, best-effort atomic (rolls back the
// Auth user if the Firestore write fails), role claim set asynchronously by
// the onProviderStaffCreated trigger.
export const createProviderStaff = onCall(async (request) => {
  if (request.auth?.token?.role !== "operatorAdmin") {
    throw new HttpsError(
      "permission-denied",
      "Only operator admins can create provider staff accounts.",
    );
  }

  if (!isCreateProviderStaffRequest(request.data)) {
    throw new HttpsError(
      "invalid-argument",
      "name, email, password, providerId, and homeBuildingId are required.",
    );
  }
  const { name, email, password, providerId, homeBuildingId } = request.data;

  const userRecord = await getAuth().createUser({
    email,
    password,
    displayName: name,
  });

  try {
    await getFirestore().collection("ProviderStaff").doc(userRecord.uid).set({
      name,
      email,
      providerId,
      homeBuildingId,
    });
  } catch (err) {
    await getAuth().deleteUser(userRecord.uid);
    throw new HttpsError(
      "internal",
      "Failed to create provider staff profile; rolled back the auth user.",
    );
  }

  return { uid: userRecord.uid };
});
