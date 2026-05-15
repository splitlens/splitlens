/**
 * Load IMAP credentials for one or more Gmail accounts from environment
 * variables. The daemon's launchd plist sets these — same pattern as
 * PHONEPE_PWD / HDFC_PWD / HDFC_CC_PWD for PDF passwords.
 *
 * Expected variables:
 *   GMAIL_USER_1 / GMAIL_APP_PWD_1   (primary account, e.g. the bills inbox)
 *   GMAIL_USER_2 / GMAIL_APP_PWD_2   (optional secondary, e.g. work inbox)
 *
 * Up to 4 accounts (suffixes 1..4) — easy to bump if needed. Missing pairs
 * are simply skipped; this returns whatever you've configured.
 */
import type { ImapAuth } from "./types";

const MAX_ACCOUNTS = 4;

export function loadEmailAccountsFromEnv(): ImapAuth[] {
  const out: ImapAuth[] = [];
  for (let i = 1; i <= MAX_ACCOUNTS; i++) {
    const user = process.env[`GMAIL_USER_${i}`];
    const password = process.env[`GMAIL_APP_PWD_${i}`];
    if (user && password) out.push({ user, password });
  }
  // Backwards-compat: also pick up the un-suffixed pair the spike CLIs use.
  if (out.length === 0) {
    const user = process.env.GMAIL_USER;
    const password = process.env.GMAIL_APP_PASSWORD;
    if (user && password) out.push({ user, password });
  }
  return out;
}
