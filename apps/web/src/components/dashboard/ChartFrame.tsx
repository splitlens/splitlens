"use client";

import { useEffect, useState, type ReactNode } from "react";

/**
 * Wraps a recharts ResponsiveContainer with a hydration gate. recharts measures
 * the DOM to compute width/height; on SSR there's no DOM, so it logs a
 * "width(-1) and height(-1) of chart should be greater than 0" warning and
 * renders nothing useful anyway. We render a fixed-height skeleton during SSR
 * and the first client tick, then swap to the real chart once mounted.
 */
export function ChartFrame({
  height = 256,
  children,
}: {
  height?: number | string;
  children: ReactNode;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <div className="w-full" style={{ height }}>
      {mounted ? (
        children
      ) : (
        <div
          className="h-full w-full animate-pulse rounded-md bg-zinc-100 dark:bg-zinc-800"
          aria-hidden
        />
      )}
    </div>
  );
}
