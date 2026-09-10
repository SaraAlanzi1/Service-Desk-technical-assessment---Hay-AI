"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export interface NavLink {
  href: string;
  label: string;
}

// Shared header for all three role-scoped layouts. Purely presentational +
// navigation (Link only) — no data fetching, no auth logic; the actual
// role gate stays in each route group's layout.tsx.
export function Header({ roleLabel, links }: { roleLabel: string; links: NavLink[] }) {
  const pathname = usePathname();

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
        <span className="ml-auto text-xs font-semibold uppercase tracking-wide text-brand-cream/70">
          {roleLabel}
        </span>
      </div>
    </header>
  );
}
