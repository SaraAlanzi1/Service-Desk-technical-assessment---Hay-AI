"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useCurrentUser } from "@/lib/auth/AuthProvider";
import { Header } from "@/components/Header";

const ADMIN_LINKS = [
  { href: "/admin/dashboard", label: "Dashboard" },
  { href: "/admin/reports", label: "Reports" },
  { href: "/admin/stats", label: "Stats" },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { loading, role } = useCurrentUser();
  const router = useRouter();

  useEffect(() => {
    if (!loading && role !== "operatorAdmin") {
      router.replace("/");
    }
  }, [loading, role, router]);

  if (loading || role !== "operatorAdmin") {
    return null;
  }

  return (
    <div className="min-h-screen bg-brand-cream">
      <Header roleLabel="Admin" links={ADMIN_LINKS} />
      {children}
    </div>
  );
}
