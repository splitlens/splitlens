"use server";

import { getTransactionsForDate, type DrillDownTxn } from "@/lib/repo";

/**
 * Server action invoked by the SpendingCalendar's day-click handler. Next.js
 * marshals the call as an RPC; the client receives the rows as a plain JSON
 * array without ever touching the SQLite file directly.
 */
export async function loadTxnsForDate(date: string): Promise<DrillDownTxn[]> {
  return getTransactionsForDate(date);
}
