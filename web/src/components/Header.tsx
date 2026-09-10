"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { signOut } from "firebase/auth";
import { auth } from "@/lib/firebase/client";

export interface NavLink {
  href: string;
  label: string;
}

// Shared header for all three role-scoped layouts. Navigation (Link) plus
// sign-out — the one auth action every role needs to switch accounts during
// a demo/review. No other auth or data logic; the role gate itself stays in
// each route group's layout.tsx.
export function Header({ roleLabel, links }: { roleLabel: string; links: NavLink[] }) {
  const pathname = usePathname();
  const router = useRouter();

  async function handleSignOut() {
    await signOut(auth);
    router.replace("/");
  }

  return (
    <header className="border-b border-brand-border bg-brand-primary">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-8 gap-y-3 px-8 py-4">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-cream text-xs font-semibold tracking-wide text-brand-primary">
            HAY
          </span>
          <span className="text-sm font-semibold text-brand-cream">The Service Desk</span>
        </div>
        <nav className="flex flex-wrap items-center gap-1">
          {links.map((link) => {
            const active = pathname === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors ${
                  active
                    ? "bg-brand-cream text-brand-primary"
                    : "text-brand-cream/80 hover:bg-brand-cream/10 hover:text-brand-cream"
                }`}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto flex items-center gap-4">
          <span className="text-xs font-semibold uppercase tracking-wide text-brand-cream/70">
            {roleLabel}
          </span>
          <button
            onClick={handleSignOut}
            className="rounded-lg border border-brand-cream/30 px-3 py-1.5 text-xs font-semibold text-brand-cream/80 transition-colors hover:bg-brand-cream/10 hover:text-brand-cream"
          >
            Sign out
          </button>
        </div>
      </div>
    </header>
  );
}
