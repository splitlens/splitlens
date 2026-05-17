"use client";

import { useCallback, useMemo, useState } from "react";
import type { MerchantMonthAxis } from "@/lib/repo";

/**
 * The merchant detail surface uses a single timeline window to recompute
 * KPIs, charts, and the ledger / txn list. This hook owns that state so the
 * Business and Person views can each consume it via a derived `Range` and
 * push updates via `setTweak` (panel) or `onRangeDrag` (chart scrub).
 *
 * The state model mirrors the design's `EDITMODE` block:
 *   - `preset` ∈ {1m, 3m, 6m, 12m, custom}
 *   - `endsAt` — months back from the latest anchor (for preset windows)
 *   - `customStart`, `customEnd` — month indices when preset = 'custom'
 *
 * The 12-month axis is index 0 (oldest) to 11 (newest, "now"). Bar charts
 * render in this order so the user reads left-to-right as time forward.
 */

export type TimelinePreset = "1m" | "3m" | "6m" | "12m" | "custom";

export interface TimelineState {
  preset: TimelinePreset;
  endsAt: number;
  customStart: number;
  customEnd: number;
}

export interface TimelineRange<T extends MerchantMonthAxis> {
  /** Inclusive index of the first in-range month on the 12-month axis. */
  startIdx: number;
  /** Inclusive index of the last in-range month on the 12-month axis. */
  endIdx: number;
  /** Number of in-range months (always >= 0). */
  nMonths: number;
  /** Human label like "Apr ’25 – Sep ’25". */
  label: string;
  /** The 12-month axis augmented with `inRange` flags. */
  months: Array<T & { idx: number; inRange: boolean }>;
}

const DEFAULT_STATE: TimelineState = {
  preset: "12m",
  endsAt: 0,
  customStart: 9,
  customEnd: 11,
};

function presetToWindow(preset: TimelinePreset): number {
  switch (preset) {
    case "1m":
      return 1;
    case "3m":
      return 3;
    case "6m":
      return 6;
    case "12m":
      return 12;
    case "custom":
      return 12; // overridden by customStart/customEnd
  }
}

/**
 * Build a derived range from a tweak state + an axis. Pure — safe to call
 * inside useMemo. Callers pass the same axis they fetched from the server.
 */
export function buildRange<T extends MerchantMonthAxis>(
  state: TimelineState,
  axis: T[],
): TimelineRange<T> {
  let startIdx: number;
  let endIdx: number;
  if (state.preset === "custom") {
    startIdx = Math.min(state.customStart, state.customEnd);
    endIdx = Math.max(state.customStart, state.customEnd);
  } else {
    const win = presetToWindow(state.preset);
    endIdx = 11 - state.endsAt;
    startIdx = Math.max(0, endIdx - win + 1);
  }
  startIdx = Math.max(0, Math.min(11, startIdx));
  endIdx = Math.max(startIdx, Math.min(11, endIdx));

  const months = axis.map((mo, i) => ({
    ...mo,
    idx: i,
    inRange: i >= startIdx && i <= endIdx,
  }));
  const label =
    startIdx === endIdx
      ? `${axis[startIdx]!.m} ’${axis[startIdx]!.y}`
      : `${axis[startIdx]!.m} ’${axis[startIdx]!.y} – ${axis[endIdx]!.m} ’${axis[endIdx]!.y}`;
  return { startIdx, endIdx, nMonths: endIdx - startIdx + 1, label, months };
}

export interface UseTimelineRange<T extends MerchantMonthAxis> {
  state: TimelineState;
  range: TimelineRange<T>;
  setPreset(preset: TimelinePreset): void;
  /** Set the chart-drag selection. Flips preset to "custom". */
  setDragRange(a: number, b: number): void;
  /** Reset to the default 12-month view. */
  reset(): void;
}

export function useTimelineRange<T extends MerchantMonthAxis>(
  axis: T[],
  initial: Partial<TimelineState> = {},
): UseTimelineRange<T> {
  const [state, setState] = useState<TimelineState>({
    ...DEFAULT_STATE,
    ...initial,
  });

  const range = useMemo(() => buildRange(state, axis), [state, axis]);

  const setPreset = useCallback((preset: TimelinePreset) => {
    setState((cur) => ({ ...cur, preset, endsAt: 0 }));
  }, []);

  const setDragRange = useCallback((a: number, b: number) => {
    const lo = Math.max(0, Math.min(11, Math.min(a, b)));
    const hi = Math.max(0, Math.min(11, Math.max(a, b)));
    setState((cur) => ({
      ...cur,
      preset: "custom",
      customStart: lo,
      customEnd: hi,
    }));
  }, []);

  const reset = useCallback(() => {
    setState(DEFAULT_STATE);
  }, []);

  return { state, range, setPreset, setDragRange, reset };
}
