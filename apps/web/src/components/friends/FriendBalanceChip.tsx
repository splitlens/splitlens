import { fmtInr } from "@/lib/format";

/**
 * "Rahul owes you ₹500" / "You owe Rahul ₹500" / "Settled" visual chip.
 * Positive net = friend owes you, negative = you owe them.
 */
export function FriendBalanceChip({
  net,
  displayName,
  size = "md",
}: {
  net: number;
  displayName: string;
  size?: "sm" | "md" | "lg";
}) {
  const abs = Math.abs(net);
  // Within ₹10 → call it settled. Avoids "₹2 owed" floating-point clutter.
  if (abs < 10) {
    return (
      <span
        className={`inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2 py-0.5 font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400 ${SIZES[size]}`}
      >
        Settled
      </span>
    );
  }
  if (net > 0) {
    return (
      <span
        className={`inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 font-medium text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-900 ${SIZES[size]}`}
        title={`${displayName} owes you ${fmtInr(abs)}`}
      >
        {displayName.split(" ")[0]} owes you {fmtInr(abs)}
      </span>
    );
  }
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 font-medium text-rose-700 ring-1 ring-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:ring-rose-900 ${SIZES[size]}`}
      title={`You owe ${displayName} ${fmtInr(abs)}`}
    >
      You owe {displayName.split(" ")[0]} {fmtInr(abs)}
    </span>
  );
}

const SIZES = {
  sm: "text-[10px]",
  md: "text-xs",
  lg: "text-sm",
};
