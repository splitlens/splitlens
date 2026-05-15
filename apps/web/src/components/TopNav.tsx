"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS: { href: "/" | "/try" | "/dashboard"; label: string; emoji: string }[] = [
  { href: "/", label: "Home", emoji: "🏠" },
  { href: "/try", label: "Upload", emoji: "📄" },
  { href: "/dashboard", label: "Dashboard", emoji: "📊" },
];

export function TopNav() {
  const pathname = usePathname();
  return (
    <nav className="bg-[color:var(--color-bg)]/80 sticky top-0 z-40 border-b border-[color:var(--color-border)] backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-3">
        <Link href="/" className="flex items-center gap-2 text-lg font-bold tracking-tight">
          <span aria-hidden>📒</span>
          SplitLens
        </Link>
        <div className="flex items-center gap-1">
          {LINKS.map((link) => {
            const active = link.href === "/" ? pathname === "/" : pathname?.startsWith(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
                  active
                    ? "bg-[color:var(--color-accent)]/15 text-[color:var(--color-accent)]"
                    : "text-[color:var(--color-muted)] hover:bg-[color:var(--color-card)] hover:text-[color:var(--color-fg)]"
                }`}
              >
                <span className="mr-1.5">{link.emoji}</span>
                {link.label}
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
