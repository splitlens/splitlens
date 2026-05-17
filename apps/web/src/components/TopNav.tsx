"use client";

/**
 * TopNav — global navigation bar matching the Hi-fi design handoff.
 *
 * Composition (left → right):
 *   - Brand mark (amber gradient tile) + "SplitLens" wordmark in serif
 *   - Nav items: Home · Dashboard · Review · Monthly · Friends · Upload
 *   - Search input (⌘K hint)
 *   - Palette switcher (4 themes from the design system)
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { Ico } from "./Ico";
import { setPalette, type PaletteId } from "./PaletteBoot";

const NAV: { href: string; label: string }[] = [
  { href: "/", label: "Home" },
  { href: "/dashboard", label: "Dashboard" },
  { href: "/review", label: "Review" },
  { href: "/reports", label: "Monthly" },
  { href: "/friends", label: "Friends" },
  { href: "/try", label: "Upload" },
];

const PALETTES: { id: PaletteId; label: string; swatch: string }[] = [
  { id: "almanac", label: "Almanac · warm dark", swatch: "#f0b14a" },
  { id: "terminal", label: "Terminal · cool", swatch: "#7dd3c0" },
  { id: "plum", label: "Plum · jewel", swatch: "#b48cf2" },
  { id: "press", label: "Press · light", swatch: "#b8732d" },
];

export function TopNav() {
  const pathname = usePathname() ?? "/";
  return (
    <header
      className="flex items-center gap-6 px-8"
      style={{
        position: "sticky",
        top: 0,
        zIndex: 40,
        height: 56,
        background: "var(--bg)",
        borderBottom: "1px solid var(--border)",
      }}
    >
      <Link
        href="/"
        className="flex items-center gap-2.5"
        style={{ textDecoration: "none", color: "var(--fg)" }}
      >
        <span
          aria-hidden
          style={{
            width: 22,
            height: 22,
            borderRadius: 5,
            background:
              "linear-gradient(135deg, var(--accent) 0%, color-mix(in srgb, var(--accent) 70%, #000) 100%)",
            position: "relative",
            display: "inline-block",
          }}
        >
          <span
            style={{
              position: "absolute",
              inset: "6px 8px 8px 6px",
              background: "var(--bg)",
              borderRadius: 2,
              display: "block",
            }}
          />
        </span>
        <span className="serif" style={{ fontSize: 22, letterSpacing: "-0.01em" }}>
          SplitLens
        </span>
      </Link>

      <nav className="flex gap-0.5 ml-4">
        {NAV.map((item) => {
          const active =
            item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-md"
              style={{
                padding: "6px 12px",
                fontSize: 13,
                color: active ? "var(--fg)" : "var(--muted)",
                background: active ? "var(--surface)" : "transparent",
                textDecoration: "none",
              }}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="ml-auto flex items-center gap-2">
        <div
          className="flex items-center gap-2"
          style={{
            padding: "0 10px",
            height: 30,
            border: "1px solid var(--border)",
            borderRadius: 8,
            background: "var(--surface)",
            minWidth: 260,
            color: "var(--muted)",
          }}
        >
          <Ico name="search" size={13} />
          <span className="small" style={{ flex: 1 }}>
            Search transactions, counterparties…
          </span>
          <span className="kbd" style={{ marginLeft: "auto" }}>
            ⌘K
          </span>
        </div>
        <PaletteSwitcher />
      </div>
    </header>
  );
}

function PaletteSwitcher() {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="btn btn-sm outline"
        aria-label="Change palette"
        title="Change palette"
      >
        <span
          aria-hidden
          style={{
            width: 12,
            height: 12,
            borderRadius: 999,
            background: "var(--accent)",
            border: "1px solid var(--border-strong)",
            display: "inline-block",
          }}
        />
        <Ico name="chevron-down" size={13} />
      </button>
      {open && (
        <div
          role="menu"
          onMouseLeave={() => setOpen(false)}
          style={{
            position: "absolute",
            right: 0,
            top: "calc(100% + 6px)",
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: 10,
            padding: 6,
            minWidth: 220,
            zIndex: 50,
            boxShadow: "0 12px 32px rgba(0, 0, 0, 0.35)",
          }}
        >
          <div className="eyebrow" style={{ padding: "4px 8px 6px" }}>
            Palette
          </div>
          {PALETTES.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => {
                setPalette(p.id);
                setOpen(false);
              }}
              className="flex items-center gap-2"
              style={{
                width: "100%",
                padding: "7px 8px",
                background: "transparent",
                border: "none",
                borderRadius: 6,
                cursor: "pointer",
                color: "var(--fg-2)",
                fontSize: 12.5,
                fontFamily: "inherit",
                textAlign: "left",
              }}
            >
              <span
                aria-hidden
                style={{
                  width: 14,
                  height: 14,
                  borderRadius: 999,
                  background: p.swatch,
                  border: "1px solid rgba(255,255,255,0.15)",
                }}
              />
              <span>{p.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
