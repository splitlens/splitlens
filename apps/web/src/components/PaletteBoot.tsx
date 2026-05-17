"use client";

/**
 * PaletteBoot — reads the persisted palette choice from localStorage and
 * sets `data-palette` on <html> before first paint to avoid a flash of the
 * default Almanac palette when the user has chosen a different theme.
 *
 * Tokens for all four palettes live in globals.css under
 * `[data-palette="almanac|terminal|plum|press"]` selectors.
 */
import { useEffect } from "react";

export type PaletteId = "almanac" | "terminal" | "plum" | "press";

export const STORAGE_KEY = "splitlens.palette";

export function PaletteBoot() {
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (
        stored === "almanac" ||
        stored === "terminal" ||
        stored === "plum" ||
        stored === "press"
      ) {
        document.documentElement.setAttribute("data-palette", stored);
      } else {
        document.documentElement.setAttribute("data-palette", "almanac");
      }
    } catch {
      /* localStorage unavailable — fall back to attribute default */
    }
  }, []);
  return null;
}

/** Imperative setter shared by the nav's palette switcher. */
export function setPalette(p: PaletteId) {
  try {
    window.localStorage.setItem(STORAGE_KEY, p);
  } catch {
    /* ignore */
  }
  document.documentElement.setAttribute("data-palette", p);
}
