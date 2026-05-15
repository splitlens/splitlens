/**
 * Browser-local Postgres via PGlite (Postgres compiled to WASM, ~3MB gzipped).
 * Persists in OPFS — survives page reloads, isolated per-origin.
 *
 * Tables are created on first init via inline DDL. We don't ship Drizzle's
 * schema-generation here yet; the schema is small enough to maintain inline
 * + matches packages/db/src/schema.ts. Any drift will be caught by typecheck
 * since both reference the same Drizzle-typed queries.
 */
"use client";

import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";

let pgliteInstance: PGlite | null = null;
let dbPromise: Promise<PgliteDatabase> | null = null;

const SCHEMA_DDL = `
CREATE TABLE IF NOT EXISTS accounts (
  id            SERIAL PRIMARY KEY,
  bank          TEXT NOT NULL,
  type          TEXT NOT NULL,
  last4         TEXT NOT NULL,
  customer_name TEXT,
  created_at    TIMESTAMP DEFAULT NOW() NOT NULL,
  CONSTRAINT accounts_unique UNIQUE (bank, type, last4)
);

CREATE TABLE IF NOT EXISTS statements (
  id           SERIAL PRIMARY KEY,
  account_id   INTEGER NOT NULL REFERENCES accounts(id),
  source_file  TEXT NOT NULL UNIQUE,
  period_from  TEXT,
  period_to    TEXT,
  page_count   INTEGER,
  txn_count    INTEGER,
  ingested_at  TIMESTAMP DEFAULT NOW() NOT NULL
);

CREATE TABLE IF NOT EXISTS transactions (
  id              SERIAL PRIMARY KEY,
  account_id      INTEGER NOT NULL REFERENCES accounts(id),
  statement_id    INTEGER NOT NULL REFERENCES statements(id),
  txn_date        TEXT NOT NULL,
  value_date      TEXT,
  narration       TEXT NOT NULL,
  ref_no          TEXT,
  withdrawal      REAL,
  deposit         REAL,
  closing_balance REAL,
  category        TEXT,
  category_rule   TEXT,
  shared_with     TEXT,
  share_count     INTEGER DEFAULT 1 NOT NULL,
  notes           TEXT,
  reviewed        BOOLEAN DEFAULT FALSE NOT NULL,
  source_row_idx  INTEGER NOT NULL,
  /** Deterministic identity per real-world transaction. Lets us dedupe across
   * statements with overlapping date ranges (e.g. monthly + yearly). */
  content_hash    TEXT,
  /** Identified counterparty — references DEFAULT_PEOPLE registry slug.
   * NULL when the txn isn't to a known person. */
  person_id       TEXT,
  created_at      TIMESTAMP DEFAULT NOW() NOT NULL,
  CONSTRAINT transactions_source_unique UNIQUE (statement_id, source_row_idx)
);

-- Migrations for existing DBs (created before these columns existed).
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS content_hash TEXT;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS person_id TEXT;

CREATE INDEX IF NOT EXISTS idx_txn_date ON transactions(txn_date);
CREATE INDEX IF NOT EXISTS idx_txn_account ON transactions(account_id);
CREATE INDEX IF NOT EXISTS idx_txn_category ON transactions(category);
CREATE INDEX IF NOT EXISTS idx_txn_person ON transactions(person_id) WHERE person_id IS NOT NULL;

-- Cross-statement deduplication: same (account, content_hash) tuple can only
-- exist once. The partial index allows older rows with NULL content_hash to
-- coexist; new ingestions always populate content_hash so they'll be deduped.
CREATE UNIQUE INDEX IF NOT EXISTS uq_txn_content_hash
  ON transactions(account_id, content_hash)
  WHERE content_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS people (
  id                 TEXT PRIMARY KEY,
  display_name       TEXT NOT NULL,
  upi_patterns_json  TEXT,
  created_at         TIMESTAMP DEFAULT NOW() NOT NULL
);

CREATE TABLE IF NOT EXISTS rules (
  id          SERIAL PRIMARY KEY,
  pattern     TEXT NOT NULL,
  category    TEXT NOT NULL,
  priority    INTEGER DEFAULT 100 NOT NULL,
  enabled     BOOLEAN DEFAULT TRUE NOT NULL,
  custom      BOOLEAN DEFAULT FALSE NOT NULL,
  created_at  TIMESTAMP DEFAULT NOW() NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rule_priority ON rules(priority);
`;

export async function getDb() {
  if (!dbPromise) {
    dbPromise = (async () => {
      // IndexedDB-backed persistence. Falls back to in-memory if unavailable.
      pgliteInstance = await PGlite.create({
        dataDir: "idb://splitlens",
      });
      // Apply schema (idempotent — IF NOT EXISTS everywhere)
      await pgliteInstance.exec(SCHEMA_DDL);
      return drizzle(pgliteInstance);
    })();
  }
  return dbPromise;
}

/** Reset the DB (drops all tables, recreates schema). Wired to dashboard's
 * "Reset all data" button. Uses PGlite's native exec() for multi-statement DDL
 * (drizzle's db.execute expects a sql`` template tag, not a raw string). */
export async function resetDb() {
  await getDb(); // ensure init
  if (!pgliteInstance) throw new Error("PGlite not initialized");

  console.log("[SplitLens] resetDb: dropping tables…");
  await pgliteInstance.exec(`
    DROP TABLE IF EXISTS transactions CASCADE;
    DROP TABLE IF EXISTS statements CASCADE;
    DROP TABLE IF EXISTS people CASCADE;
    DROP TABLE IF EXISTS rules CASCADE;
    DROP TABLE IF EXISTS accounts CASCADE;
  `);
  console.log("[SplitLens] resetDb: re-applying schema…");
  await pgliteInstance.exec(SCHEMA_DDL);
  console.log("[SplitLens] resetDb: done");
}
