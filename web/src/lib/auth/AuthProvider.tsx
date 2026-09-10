"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { onAuthStateChanged, type User } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase/client";
import type { Role } from "@hay-service-desk/shared";

const collectionForRole: Record<Role, string> = {
  tenant: "Tenant",
  providerStaff: "ProviderStaff",
  operatorAdmin: "OperatorAdmin",
};

interface AuthContextValue {
  loading: boolean;
  uid: string | null;
  role: Role | null;
  profile: Record<string, unknown> | null;
}

const initialState: AuthContextValue = {
  loading: true,
  uid: null,
  role: null,
  profile: null,
};

const AuthContext = createContext<AuthContextValue>(initialState);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthContextValue>(initialState);

  useEffect(() => {
    return onAuthStateChanged(auth, async (user: User | null) => {
      if (!user) {
        setState({ loading: false, uid: null, role: null, profile: null });
        return;
      }

      // Custom claims are set asynchronously by the role-assignment trigger,
      // so a brand-new account's first token may not have `role` yet.
      const tokenResult = await user.getIdTokenResult();
      const role = (tokenResult.claims.role as Role | undefined) ?? null;

      let profile: Record<string, unknown> | null = null;
      if (role) {
        const snap = await getDoc(doc(db, collectionForRole[role], user.uid));
        profile = snap.exists() ? snap.data() : null;
      }

      setState({ loading: false, uid: user.uid, role, profile });
    });
  }, []);

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;
}

export function useCurrentUser(): AuthContextValue {
  return useContext(AuthContext);
}
