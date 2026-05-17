import { fmtInr } from "@/lib/format";

/**
 * "Rahul owes you ₹500" / "You owe Rahul ₹500" / "Settled" visual chip.
 * Positive net = friend owes you, negative = you owe them. Rendered with
 * the design system's .chip primitives — credit/debit accents inline.
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
  const cls = size === "sm" ? "chip chip-sm" : "chip";
  const fontSize = size === "lg" ? 13.5 : size === "md" ? 12 : 11;

  // Within ₹10 → call it settled. Avoids "₹2 owed" floating-point clutter.
  if (abs < 10) {
    return (
      <span className={`${cls} ghost`} style={{ fontSize }}>
        Settled
      </span>
    );
  }
  if (net > 0) {
    return (
      <span
        className={cls}
        style={{
          fontSize,
          color: "var(--credit)",
          borderColor: "var(--credit)",
          background: "color-mix(in srgb, var(--credit) 8%, transparent)",
        }}
        title={`${displayName} owes you ${fmtInr(abs)}`}
      >
        {displayName.split(" ")[0]} owes you{" "}
        <span className="mono tabular">{fmtInr(abs)}</span>
      </span>
    );
  }
  return (
    <span
      className={cls}
      style={{
        fontSize,
        color: "var(--debit)",
        borderColor: "var(--debit)",
        background: "color-mix(in srgb, var(--debit) 8%, transparent)",
      }}
      title={`You owe ${displayName} ${fmtInr(abs)}`}
    >
      You owe {displayName.split(" ")[0]}{" "}
      <span className="mono tabular">{fmtInr(abs)}</span>
    </span>
  );
}
