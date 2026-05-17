/**
 * SQLite client wiring for SplitLens. The DB file lives at the OS-conventional
 * application-data directory (e.g. ~/Library/Application Support/splitlens on
 * macOS); the daemon and any CLI tools open the same file.
 *
 * `openDb()` is idempotent — runs INIT_DDL with IF NOT EXISTS, so re-opening
 * an existing database is safe and a no-op for already-present tables. Schema
 * evolution will move to versioned migrations once we have data we'd rather
 * not drop.
 */
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir, platform } from "node:os";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";

/**
 * Drizzle client over better-sqlite3. The native handle is accessible at
 * `db.$client` (Drizzle's built-in) for tools that need PRAGMA / VACUUM /
 * raw SQL.
 */
export type SplitLensDb = BetterSQLite3Database<typeof schema>;

/**
 * The canonical on-disk location for the SplitLens SQLite file. Daemon and CLI
 * tools all read/write here unless overridden via env var SPLITLENS_DB_PATH.
 */
export function defaultDbPath(): string {
  const override = process.env.SPLITLENS_DB_PATH;
  if (override) return override;
  const home = homedir();
  if (platform() === "darwin") {
    return join(home, "Library", "Application Support", "splitlens", "splitlens.sqlite");
  }
  // Linux (XDG) — Windows path comes later if we ever ship there.
  const xdg = process.env.XDG_DATA_HOME ?? join(home, ".local", "share");
  return join(xdg, "splitlens", "splitlens.sqlite");
}

/**
 * Open or create the SplitLens SQLite database at `filePath` (default:
 * defaultDbPath()). Creates the parent directory if missing, enables WAL +
 * foreign keys, runs INIT_DDL, and returns a Drizzle client with `$raw`
 * attached for native handle access.
 */
export function openDb(filePath: string = defaultDbPath()): SplitLensDb {
  mkdirSync(dirname(filePath), { recursive: true });
  const sqlite = new Database(filePath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(INIT_DDL);
  return drizzle(sqlite, { schema });
}

/**
 * Close the underlying better-sqlite3 handle. Provided as a helper so
 * downstream packages don't need a direct `drizzle-orm` dep just to reach
 * `db.$client.close()`.
 */
export function closeDb(db: SplitLensDb): void {
  (db as unknown as { $client: Database.Database }).$client.close();
}

/**
 * Mirrors the Drizzle definitions in schema.ts. Hand-maintained for now to
 * avoid pulling drizzle-kit into the runtime. Whenever schema.ts gains a
 * column, this string must be updated and (for new columns on existing tables)
 * a matching ALTER TABLE … ADD COLUMN appended.
 */
const INIT_DDL = `
CREATE TABLE IF NOT EXISTS accounts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  bank          TEXT NOT NULL,
  type          TEXT NOT NULL,
  last4         TEXT NOT NULL,
  customer_name TEXT,
  created_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_account_bank_type_last4 ON accounts(bank, type, last4);

CREATE TABLE IF NOT EXISTS statements (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id   INTEGER NOT NULL REFERENCES accounts(id),
  source_file  TEXT NOT NULL,
  source_hash  TEXT NOT NULL,
  source_type  TEXT NOT NULL,
  period_from  TEXT,
  period_to    TEXT,
  page_count   INTEGER,
  txn_count    INTEGER,
  ingested_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_statement_source_hash ON statements(source_hash);
CREATE INDEX IF NOT EXISTS idx_statement_account ON statements(account_id);

CREATE TABLE IF NOT EXISTS transactions (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id        INTEGER NOT NULL REFERENCES accounts(id),
  txn_date          TEXT NOT NULL,
  txn_time          TEXT,
  value_date        TEXT,
  narration         TEXT,
  ref_no            TEXT,
  withdrawal        REAL,
  deposit           REAL,
  closing_balance   REAL,
  counterparty      TEXT,
  counterparty_kind TEXT,
  person_id         TEXT,
  category          TEXT,
  category_rule     TEXT,
  shared_with       TEXT,
  share_count       INTEGER NOT NULL DEFAULT 1,
  notes             TEXT,
  reviewed          INTEGER NOT NULL DEFAULT 0,
  linked_txn_id     INTEGER REFERENCES transactions(id),
  created_at        TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_txn_date     ON transactions(txn_date);
CREATE INDEX IF NOT EXISTS idx_txn_account  ON transactions(account_id);
CREATE INDEX IF NOT EXISTS idx_txn_category ON transactions(category);
CREATE INDEX IF NOT EXISTS idx_txn_ref_no   ON transactions(ref_no);
CREATE INDEX IF NOT EXISTS idx_txn_person   ON transactions(person_id);
CREATE INDEX IF NOT EXISTS idx_txn_linked   ON transactions(linked_txn_id) WHERE linked_txn_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS transaction_sources (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  transaction_id  INTEGER NOT NULL REFERENCES transactions(id),
  source_type     TEXT NOT NULL,
  statement_id    INTEGER NOT NULL REFERENCES statements(id),
  source_row_idx  INTEGER NOT NULL,
  source_txn_id   TEXT,
  raw_json        TEXT NOT NULL,
  ingested_at     TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_source_statement_row ON transaction_sources(statement_id, source_row_idx);
CREATE INDEX IF NOT EXISTS idx_source_transaction ON transaction_sources(transaction_id);
CREATE INDEX IF NOT EXISTS idx_source_txn_id      ON transaction_sources(source_txn_id);

CREATE TABLE IF NOT EXISTS people (
  id                TEXT PRIMARY KEY,
  display_name      TEXT NOT NULL,
  upi_patterns_json TEXT,
  created_at        TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS rules (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  pattern    TEXT NOT NULL,
  category   TEXT NOT NULL,
  priority   INTEGER NOT NULL DEFAULT 100,
  enabled    INTEGER NOT NULL DEFAULT 1,
  custom     INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_rule_priority ON rules(priority);
`;
