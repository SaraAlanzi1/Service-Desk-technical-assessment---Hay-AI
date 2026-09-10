import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { getAuth } from "firebase-admin/auth";
import type { Role } from "@hay-service-desk/shared";

// Single source of truth for role-claim assignment. Fires for every profile
// doc creation path: the provisioning callables (createTenant,
// createProviderStaff) AND the manually-seeded bootstrap OperatorAdmin —
// both just create a Firestore doc, and this trigger reacts to it.
async function assignRoleClaim(uid: string, role: Role): Promise<void> {
  await getAuth().setCustomUserClaims(uid, { role });
}

export const onTenantCreated = onDocumentCreated("Tenant/{uid}", async (event) => {
  await assignRoleClaim(event.params.uid, "tenant");
});

export const onProviderStaffCreated = onDocumentCreated(
  "ProviderStaff/{uid}",
  async (event) => {
    await assignRoleClaim(event.params.uid, "providerStaff");
  },
);

export const onOperatorAdminCreated = onDocumentCreated(
  "OperatorAdmin/{uid}",
  async (event) => {
    await assignRoleClaim(event.params.uid, "operatorAdmin");
  },
);
