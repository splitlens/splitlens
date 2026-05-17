/**
 * Self-rescheduling polling loop.
 *
 * We use a chained `setTimeout` instead of `setInterval` because:
 *   - The next tick is scheduled by hand on each iteration. If a future
 *     iteration is slow we can `clearTimeout` and reset, instead of having
 *     a fixed-cadence interval blast away in the background.
 *   - Errors thrown by `runOnce` never escape (caught + surfaced via
 *     `onError`); the loop always reschedules.
 *   - `cancel()` clears the pending timer; an in-flight iteration is allowed
 *     to finish (we just don't reschedule another one).
 *
 * Overlap-prevention: each `tick` schedules the NEXT tick before starting
 * work. If `runOnce` runs longer than `intervalMs`, the next tick observes
 * `running === true` and is skipped (via `onSkip`) instead of running twice
 * concurrently — important when `runOnce` opens IMAP connections.
 *
 * Pure utility — no daemon-specific imports — so it's trivial to unit-test
 * with `vi.useFakeTimers()`.
 */

export interface ScheduleHandle {
  /** Stop the loop. Idempotent. An in-flight iteration finishes naturally. */
  cancel(): void;
  /** True after `cancel()` has been called. */
  readonly cancelled: boolean;
}

export interface SchedulePollOptions {
  /** Called when a tick fires while the previous one is still running. */
  onSkip?: () => void;
  /** Called when `runOnce` throws/rejects. The loop continues regardless. */
  onError?: (err: unknown) => void;
  /** Optional clock injection — defaults to global setTimeout/clearTimeout. */
  setTimeoutImpl?: typeof setTimeout;
  clearTimeoutImpl?: typeof clearTimeout;
}

/**
 * Schedule `runOnce` to run every `intervalMs`. The first tick fires AFTER
 * `intervalMs` (caller is expected to have already executed the initial run
 * before calling us — that's how main.ts is structured).
 *
 * Overlap prevention: if a tick fires while the previous iteration is still
 * pending, this tick is skipped and we just reschedule the next one.
 */
export function schedulePoll(
  intervalMs: number,
  runOnce: () => Promise<void> | void,
  opts: SchedulePollOptions = {},
): ScheduleHandle {
  const setT = opts.setTimeoutImpl ?? setTimeout;
  const clearT = opts.clearTimeoutImpl ?? clearTimeout;

  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  let cancelled = false;

  const tick = async () => {
    timer = null;
    if (cancelled) return;

    // Schedule the NEXT tick before we start work. This way, even if
    // `runOnce` is slow, the cadence is preserved and a subsequent tick
    // can observe `running === true` and skip itself.
    schedule();

    if (running) {
      opts.onSkip?.();
      return;
    }
    running = true;
    try {
      await runOnce();
    } catch (e) {
      opts.onError?.(e);
    } finally {
      running = false;
    }
  };

  const schedule = () => {
    if (cancelled) return;
    timer = setT(tick, intervalMs);
  };

  schedule();

  return {
    cancel() {
      cancelled = true;
      if (timer !== null) {
        clearT(timer);
        timer = null;
      }
    },
    get cancelled() {
      return cancelled;
    },
  };
}

/**
 * Parse `SPLITLENS_EMAIL_POLL_MINUTES` into a millisecond interval.
 *   - undefined / empty / not-a-number → default (30 minutes)
 *   - `0` → null (polling disabled)
 *   - any positive value < 5 → clamped to 5 (avoid hammering Gmail)
 *   - any positive value ≥ 5 → that many minutes
 *
 * Returns null when polling is disabled.
 */
export function parsePollIntervalMs(
  raw: string | undefined,
  defaultMinutes = 30,
  minMinutes = 5,
): number | null {
  if (raw === undefined || raw === "") {
    return defaultMinutes * 60_000;
  }
  const n = Number(raw);
  if (!Number.isFinite(n) || Number.isNaN(n)) {
    return defaultMinutes * 60_000;
  }
  if (n === 0) return null;
  if (n < minMinutes) return minMinutes * 60_000;
  return n * 60_000;
}
