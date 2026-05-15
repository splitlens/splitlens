import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { parsePollIntervalMs, schedulePoll } from "../src/poll";

describe("parsePollIntervalMs", () => {
  it("returns the default (30m) for undefined / empty / non-numeric input", () => {
    expect(parsePollIntervalMs(undefined)).toBe(30 * 60_000);
    expect(parsePollIntervalMs("")).toBe(30 * 60_000);
    expect(parsePollIntervalMs("garbage")).toBe(30 * 60_000);
  });

  it("returns null when explicitly disabled with '0'", () => {
    expect(parsePollIntervalMs("0")).toBe(null);
  });

  it("clamps positive values below the 5-minute floor", () => {
    expect(parsePollIntervalMs("1")).toBe(5 * 60_000);
    expect(parsePollIntervalMs("4")).toBe(5 * 60_000);
  });

  it("honours valid values at or above the floor", () => {
    expect(parsePollIntervalMs("5")).toBe(5 * 60_000);
    expect(parsePollIntervalMs("15")).toBe(15 * 60_000);
    expect(parsePollIntervalMs("60")).toBe(60 * 60_000);
  });

  it("respects custom default + min", () => {
    expect(parsePollIntervalMs(undefined, 10, 2)).toBe(10 * 60_000);
    expect(parsePollIntervalMs("1", 10, 2)).toBe(2 * 60_000);
  });
});

describe("schedulePoll", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does NOT invoke runOnce before the first interval elapses", () => {
    const run = vi.fn(async () => {});
    const handle = schedulePoll(1000, run);
    expect(run).not.toHaveBeenCalled();
    handle.cancel();
  });

  it("invokes runOnce on each tick at the configured interval", async () => {
    const run = vi.fn(async () => {});
    const handle = schedulePoll(1000, run);

    await vi.advanceTimersByTimeAsync(1000);
    expect(run).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1000);
    expect(run).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(3000);
    expect(run).toHaveBeenCalledTimes(5);

    handle.cancel();
  });

  it("skips overlapping ticks while a long-running iteration is in flight", async () => {
    // runOnce takes 5 intervals to finish. With overlap-prevention, the
    // ticks that fire while it's running should be SKIPPED, not queued.
    let resolveRun: (() => void) | null = null;
    const run = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveRun = resolve;
        }),
    );
    const onSkip = vi.fn();
    const handle = schedulePoll(1000, run, { onSkip });

    // Fire tick 1 — runOnce starts but doesn't resolve.
    await vi.advanceTimersByTimeAsync(1000);
    expect(run).toHaveBeenCalledTimes(1);
    expect(onSkip).not.toHaveBeenCalled();

    // Three more intervals pass while runOnce is still pending — each
    // should fire onSkip and NOT call runOnce again.
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);
    expect(run).toHaveBeenCalledTimes(1);
    expect(onSkip).toHaveBeenCalledTimes(3);

    // Now let the in-flight call finish. The next scheduled tick should
    // fire runOnce again, cleanly.
    resolveRun!();
    await vi.advanceTimersByTimeAsync(0); // flush the resolved promise
    await vi.advanceTimersByTimeAsync(1000);
    expect(run).toHaveBeenCalledTimes(2);

    handle.cancel();
  });

  it("keeps polling after runOnce throws — error is surfaced via onError", async () => {
    let i = 0;
    const run = vi.fn(async () => {
      i += 1;
      if (i === 2) throw new Error("transient IMAP failure");
    });
    const onError = vi.fn();
    const handle = schedulePoll(1000, run, { onError });

    await vi.advanceTimersByTimeAsync(1000);
    expect(run).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();

    // Tick 2 throws.
    await vi.advanceTimersByTimeAsync(1000);
    expect(run).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenCalledTimes(1);
    expect((onError.mock.calls[0]![0] as Error).message).toBe(
      "transient IMAP failure",
    );

    // Loop must keep going after the throw.
    await vi.advanceTimersByTimeAsync(1000);
    expect(run).toHaveBeenCalledTimes(3);

    handle.cancel();
  });

  it("cancel() stops further ticks and is idempotent", async () => {
    const run = vi.fn(async () => {});
    const handle = schedulePoll(1000, run);

    await vi.advanceTimersByTimeAsync(1000);
    expect(run).toHaveBeenCalledTimes(1);

    handle.cancel();
    expect(handle.cancelled).toBe(true);

    // Several intervals later — no further calls.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(run).toHaveBeenCalledTimes(1);

    // Idempotent.
    expect(() => handle.cancel()).not.toThrow();
    expect(handle.cancelled).toBe(true);
  });

  it("cancel() during an in-flight iteration prevents reschedule but lets the current call finish", async () => {
    let resolveRun: (() => void) | null = null;
    const run = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveRun = resolve;
        }),
    );
    const handle = schedulePoll(1000, run);

    await vi.advanceTimersByTimeAsync(1000);
    expect(run).toHaveBeenCalledTimes(1);

    // Cancel while runOnce is still pending.
    handle.cancel();

    // Resolve the in-flight call. No reschedule should occur.
    resolveRun!();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(run).toHaveBeenCalledTimes(1);
  });
});
