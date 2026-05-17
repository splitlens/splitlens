"use client";

import type { TimelinePreset } from "./useTimelineRange";

/**
 * Segmented preset selector for the merchant detail timeline. The "custom"
 * state is implicit — entered by chart-drag — so the buttons only show the
 * four named presets to keep the header tight (matches the verifier feedback
 * in the design chat).
 */
export function TimelineRangeControl({
  preset,
  onPresetChange,
  onReset,
  rangeLabel,
  isCustom,
}: {
  preset: TimelinePreset;
  onPresetChange: (preset: TimelinePreset) => void;
  onReset: () => void;
  rangeLabel: string;
  isCustom: boolean;
}) {
  const opts: { value: TimelinePreset; label: string }[] = [
    { value: "1m", label: "1m" },
    { value: "3m", label: "3m" },
    { value: "6m", label: "6m" },
    { value: "12m", label: "12m" },
  ];
  return (
    <div className="md-range-bar">
      <div className="md-range-seg" role="radiogroup" aria-label="Timeline window">
        {opts.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={!isCustom && preset === o.value}
            className={!isCustom && preset === o.value ? "on" : ""}
            onClick={() => onPresetChange(o.value)}
          >
            {o.label}
          </button>
        ))}
        {isCustom && (
          <button type="button" className="on" aria-checked="true" role="radio">
            custom
          </button>
        )}
      </div>
      <span className="md-range-hint">
        Showing <span className="accent">{rangeLabel}</span> · drag the chart
        to scrub
      </span>
      {isCustom && (
        <button type="button" className="btn ghost" onClick={onReset}>
          Reset to 12m
        </button>
      )}
    </div>
  );
}
