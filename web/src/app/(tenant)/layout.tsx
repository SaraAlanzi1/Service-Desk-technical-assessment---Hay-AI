"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useCurrentUser } from "@/lib/auth/AuthProvider";
import { Header } from "@/components/Header";

const TENANT_LINKS = [
  { href: "/tenant/dashboard", label: "Dashboard" },
  { href: "/tenant/tickets", label: "My Tickets" },
  { href: "/tenant/tickets/new", label: "New Ticket" },
];

// Route-group layout: UX-only gate. The real security barrier is Firestore
// Security Rules — this just avoids rendering the wrong role's UI.
export default function TenantLayout({ children }: { children: React.ReactNode }) {
  const { loading, role } = useCurrentUser();
  const router = useRouter();

  useEffect(() => {
    if (!loading && role !== "tenant") {
      router.replace("/");
    }
  }, [loading, role, router]);

  if (loading || role !== "tenant") {
    return null;
  }

  return (
    <div className="min-h-screen bg-brand-cream">
      <Header roleLabel="Tenant" links={TENANT_LINKS} />
      {children}
    </div>
  );
}
