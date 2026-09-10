"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useCurrentUser } from "@/lib/auth/AuthProvider";
import { Header } from "@/components/Header";

const PROVIDER_LINKS = [
  { href: "/provider/dashboard", label: "Dashboard" },
  { href: "/provider/queue", label: "Queue" },
  { href: "/provider/reports", label: "Reports" },
];

export default function ProviderLayout({ children }: { children: React.ReactNode }) {
  const { loading, role } = useCurrentUser();
  const router = useRouter();

  useEffect(() => {
    if (!loading && role !== "providerStaff") {
      router.replace("/");
    }
  }, [loading, role, router]);

  if (loading || role !== "providerStaff") {
    return null;
  }

  return (
    <div className="min-h-screen bg-brand-cream">
      <Header roleLabel="Provider" links={PROVIDER_LINKS} />
      {children}
    </div>
  );
}
