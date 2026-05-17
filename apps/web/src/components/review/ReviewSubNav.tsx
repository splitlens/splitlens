"use client";

/**
 * Sub-nav for the /review route. Two pill-shaped buttons that toggle
 * between the category-focused and split-focused review surfaces.
 *
 * usePathname drives the active highlight so the nav reflects the
 * current view without needing to thread state through. Rendered at
 * the top of every /review sub-page via /review/layout.tsx.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";

import { Ico } from "@/components/Ico";

const TABS = [
  {
    href: "/review/category",
    label: "By category",
    sublabel: "What was this for?",
    icon: "filter" as const,
  },
  {
    href: "/review/split",
    label: "By split",
    sublabel: "Who owes whom?",
    icon: "users" as const,
  },
];

export function ReviewSubNav() {
  const pathname = usePathname() ?? "";
  return (
    <div
      style={{
        display: "flex",
        gap: 6,
        padding: "14px 32px 0",
        borderBottom: "1px solid var(--border)",
        background: "var(--bg)",
        alignItems: "stretch",
      }}
    >
      {TABS.map((t) => {
        const active = pathname.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "10px 14px 12px",
              color: active ? "var(--fg)" : "var(--muted)",
              borderBottom: `2px solid ${
                active ? "var(--accent)" : "transparent"
              }`,
              textDecoration: "none",
              transition: "color 180ms var(--ease-out), border-color 180ms var(--ease-out)",
            }}
          >
            <Ico
              name={t.icon}
              size={14}
              className={active ? "accent" : "muted"}
            />
            <span
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 1,
              }}
            >
              <span style={{ fontSize: 13.5, fontWeight: 500 }}>
                {t.label}
              </span>
              <span
                style={{
                  fontSize: 11,
                  color: active ? "var(--muted)" : "var(--muted-2)",
                }}
              >
                {t.sublabel}
              </span>
            </span>
          </Link>
        );
      })}
    </div>
  );
}
