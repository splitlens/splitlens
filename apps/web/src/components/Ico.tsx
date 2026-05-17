"use client";

/**
 * Ico — the small line-icon set from the design handoff (Lucide-flavored).
 * Renders an inline SVG with `currentColor` stroke so it inherits the
 * parent text color and the .ico CSS class controls size + stroke width.
 *
 * Usage: <Ico name="search" size={13} />
 */

export type IcoName =
  | "search"
  | "arrow-right"
  | "arrow-left"
  | "check"
  | "x"
  | "chevron-right"
  | "chevron-left"
  | "chevron-down"
  | "calendar"
  | "filter"
  | "repeat"
  | "users"
  | "user"
  | "split"
  | "paperclip"
  | "sparkles"
  | "bell"
  | "flag"
  | "eye"
  | "more"
  | "plus"
  | "minus"
  | "trending-up"
  | "corner-down-right"
  | "inbox"
  | "book"
  | "settings"
  | "map-pin";

export interface IcoProps {
  name: IcoName;
  size?: number;
  className?: string;
  "aria-hidden"?: boolean;
}

export function Ico({ name, size = 16, className = "", ...rest }: IcoProps) {
  const cls = `ico ${
    size === 13 ? "ico-sm" : size === 20 ? "ico-lg" : ""
  } ${className}`;
  const props = { className: cls, viewBox: "0 0 24 24", "aria-hidden": rest["aria-hidden"] ?? true } as const;
  switch (name) {
    case "search":
      return (
        <svg {...props}>
          <circle cx="11" cy="11" r="7" />
          <path d="M21 21l-4.3-4.3" />
        </svg>
      );
    case "arrow-right":
      return (
        <svg {...props}>
          <path d="M5 12h14M13 5l7 7-7 7" />
        </svg>
      );
    case "arrow-left":
      return (
        <svg {...props}>
          <path d="M19 12H5M11 5l-7 7 7 7" />
        </svg>
      );
    case "check":
      return (
        <svg {...props}>
          <path d="M20 6L9 17l-5-5" />
        </svg>
      );
    case "x":
      return (
        <svg {...props}>
          <path d="M18 6L6 18M6 6l12 12" />
        </svg>
      );
    case "chevron-right":
      return (
        <svg {...props}>
          <path d="M9 18l6-6-6-6" />
        </svg>
      );
    case "chevron-left":
      return (
        <svg {...props}>
          <path d="M15 18l-6-6 6-6" />
        </svg>
      );
    case "chevron-down":
      return (
        <svg {...props}>
          <path d="M6 9l6 6 6-6" />
        </svg>
      );
    case "calendar":
      return (
        <svg {...props}>
          <rect x="3" y="5" width="18" height="16" rx="2" />
          <path d="M3 10h18M8 3v4M16 3v4" />
        </svg>
      );
    case "filter":
      return (
        <svg {...props}>
          <path d="M3 4h18l-7 9v6l-4 2v-8z" />
        </svg>
      );
    case "repeat":
      return (
        <svg {...props}>
          <path d="M17 1l4 4-4 4M3 11V9a4 4 0 014-4h14M7 23l-4-4 4-4M21 13v2a4 4 0 01-4 4H3" />
        </svg>
      );
    case "users":
      return (
        <svg {...props}>
          <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" />
        </svg>
      );
    case "user":
      return (
        <svg {...props}>
          <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
          <circle cx="12" cy="7" r="4" />
        </svg>
      );
    case "split":
      return (
        <svg {...props}>
          <path d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5" />
        </svg>
      );
    case "paperclip":
      return (
        <svg {...props}>
          <path d="M21.4 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
        </svg>
      );
    case "sparkles":
      return (
        <svg {...props}>
          <path d="M12 3l1.5 5L19 9.5l-5.5 1.5L12 16l-1.5-5L5 9.5 10.5 8z" />
          <path d="M19 17l.7 2.3L22 20l-2.3.7L19 23l-.7-2.3L16 20l2.3-.7z" />
        </svg>
      );
    case "map-pin":
      return (
        <svg {...props}>
          <path d="M20 10c0 7-8 13-8 13s-8-6-8-13a8 8 0 0116 0z" />
          <circle cx="12" cy="10" r="3" />
        </svg>
      );
    case "bell":
      return (
        <svg {...props}>
          <path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 01-3.4 0" />
        </svg>
      );
    case "flag":
      return (
        <svg {...props}>
          <path d="M4 22V4M4 4h14l-3 5 3 5H4" />
        </svg>
      );
    case "eye":
      return (
        <svg {...props}>
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      );
    case "more":
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="1.5" />
          <circle cx="5" cy="12" r="1.5" />
          <circle cx="19" cy="12" r="1.5" />
        </svg>
      );
    case "plus":
      return (
        <svg {...props}>
          <path d="M12 5v14M5 12h14" />
        </svg>
      );
    case "minus":
      return (
        <svg {...props}>
          <path d="M5 12h14" />
        </svg>
      );
    case "trending-up":
      return (
        <svg {...props}>
          <path d="M23 6l-9.5 9.5-5-5L1 18M17 6h6v6" />
        </svg>
      );
    case "corner-down-right":
      return (
        <svg {...props}>
          <path d="M15 10l5 5-5 5M4 4v7a4 4 0 004 4h12" />
        </svg>
      );
    case "inbox":
      return (
        <svg {...props}>
          <path d="M22 12h-6l-2 3h-4l-2-3H2M5.45 5.11L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z" />
        </svg>
      );
    case "book":
      return (
        <svg {...props}>
          <path d="M4 19.5A2.5 2.5 0 016.5 17H20V2H6.5A2.5 2.5 0 004 4.5z" />
          <path d="M4 19.5V22h16" />
        </svg>
      );
    case "settings":
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09a1.65 1.65 0 00-1-1.51 1.65 1.65 0 00-1.82.33l-.06.06A2 2 0 113.4 16.96l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H2a2 2 0 110-4h.09a1.65 1.65 0 001.51-1 1.65 1.65 0 00-.33-1.82l-.06-.06A2 2 0 116.04 3.4l.06.06a1.65 1.65 0 001.82.33H8a1.65 1.65 0 001-1.51V2a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V8a1.65 1.65 0 001.51 1H22a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z" />
        </svg>
      );
    default:
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="3" />
        </svg>
      );
  }
}
