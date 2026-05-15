import type {
  Settlement,
  SettlementEntry,
  RawTransaction,
  SharedTransaction,
} from "../types/index";
import type { Person } from "../people/registry";

/**
 * Compute net settlement per person from shared expenses + repayment inflows.
 *
 * Algorithm:
 *  - For each shared OUT transaction with N people total, each named person owes
 *    `amount / N` (since I, the payer, also have a 1/N share).
 *  - For each IN transaction whose narration matches a person's UPI patterns,
 *    add the amount to that person's `paidBack`.
 *  - net = owesMe - paidBack. Positive = they owe me. Negative = I owe them.
 */
export function computeSettlement(
  sharedTxns: SharedTransaction[],
  inflows: RawTransaction[],
  people: Record<string, Person>,
): Settlement {
  const result: Settlement = {};

  const ensure = (id: string): SettlementEntry => {
    let e = result[id];
    if (!e) {
      e = { owesMe: 0, paidBack: 0, net: 0 };
      result[id] = e;
    }
    return e;
  };

  // Step 1: each person's share of shared expenses I paid for
  for (const txn of sharedTxns) {
    if (txn.direction !== "out") continue;
    const splitN = Math.max(1, txn.shareCount);
    const sharePerPerson = txn.amount / splitN;
    for (const pid of txn.sharedWith) {
      const entry = ensure(pid.toLowerCase());
      entry.owesMe += sharePerPerson;
    }
  }

  // Step 2: repayments from each person, matched by their UPI patterns
  for (const [pid, person] of Object.entries(people)) {
    if (person.upiPatterns.length === 0) continue;
    const patterns = person.upiPatterns.map((p) => new RegExp(p, "i"));
    for (const inflow of inflows) {
      if (inflow.deposit == null || inflow.deposit <= 0) continue;
      if (patterns.some((re) => re.test(inflow.narration))) {
        const entry = ensure(pid.toLowerCase());
        entry.paidBack += inflow.deposit;
      }
    }
  }

  // Step 3: compute net + round to 2 decimals
  for (const id of Object.keys(result)) {
    const e = result[id];
    if (!e) continue;
    e.owesMe = round2(e.owesMe);
    e.paidBack = round2(e.paidBack);
    e.net = round2(e.owesMe - e.paidBack);
  }

  return result;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
