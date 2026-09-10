"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { signInWithEmailAndPassword } from "firebase/auth";
import { auth } from "@/lib/firebase/client";
import { useCurrentUser } from "@/lib/auth/AuthProvider";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import type { Role } from "@hay-service-desk/shared";

const dashboardForRole: Record<Role, string> = {
  tenant: "/tenant/dashboard",
  providerStaff: "/provider/dashboard",
  operatorAdmin: "/admin/dashboard",
};

export default function SignInPage() {
  const { loading, role } = useCurrentUser();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!loading && role) {
      router.replace(dashboardForRole[role]);
    }
  }, [loading, role, router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  if (loading || role) {
    return null;
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-brand-cream p-8">
      <div className="flex flex-col items-center gap-3">
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-brand-primary text-base font-semibold tracking-wide text-brand-cream">
          HAY
        </span>
        <h1 className="text-xl font-semibold text-brand-primary">The Service Desk</h1>
      </div>
      <Card className="w-full max-w-xs">
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <Input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <Input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <Button type="submit" disabled={submitting}>
            Sign in
          </Button>
        </form>
        {error && <p className="mt-3 text-sm text-brand-error">{error}</p>}
      </Card>
    </main>
  );
}
