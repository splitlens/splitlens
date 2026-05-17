/**
 * SplitLens database schema — SQLite dialect.
 *
 * v2 schema (post the PGlite → SQLite cutover). The shape is built around
 * a single canonical `transactions` table at the core, with `transaction_sources`
 * recording every statement that observed each canonical transaction. This lets
 * the same real-world money movement (e.g. ₹672 paid to Blinkit) be enriched by
 * whatever sources we've ingested — HDFC bank narration, PhonePe timestamp +
 * UTR, Zomato order id + items, etc. — without ever duplicating the ledger row.
 *
 * Source-of-truth rule: this file. The legacy raw DDL in apps/web/src/lib/db.ts
 * was a duplicate; it goes away when the web app is rewired to the daemon's
 * localhost API (P7).
 */
import {
  sqliteTable,
  integer,
  text,
  real,
  uniqueIndex,
  index,
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

// SQLite stores timestamps as TEXT (ISO 8601) for human-readability + tooling
// compatibility (DB Browser, sqlite3 CLI). All defaults use CURRENT_TIMESTAMP.
const isoTimestamp = (name: string) =>
  text(name)
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`);

export const accounts = sqliteTable(
  "accounts",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    /** 'HDFC', 'ICICI', 'AXIS', ... — or 'PhonePe' for wallet-only synthetic accounts. */
    bank: text("bank").notNull(),
    /** 'savings' | 'credit_card' | 'phonepe_wallet' | 'gpay_wallet'. */
    type: text("type").notNull(),
    last4: text("last4").notNull(),
    customerName: text("customer_name"),
    createdAt: isoTimestamp("created_at"),
  },
  (t) => ({
    unq: uniqueIndex("uq_account_bank_type_last4").on(t.bank, t.type, t.last4),
  }),
);

export const statements = sqliteTable(
  "statements",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    accountId: integer("account_id")
      .references(() => accounts.id)
      .notNull(),
    /** Absolute path of the source PDF in Documents/bank/archive/... */
    sourceFile: text("source_file").notNull(),
    /** SHA-256 of file bytes — dedup re-imports of the same file under a new name. */
    sourceHash: text("source_hash").notNull(),
    /** 'hdfc_savings' | 'hdfc_cc' | 'phonepe' | 'gpay' | 'cred' | 'swiggy' | 'zomato' | ... */
    sourceType: text("source_type").notNull(),
    periodFrom: text("period_from"),
    periodTo: text("period_to"),
    pageCount: integer("page_count"),
    txnCount: integer("txn_count"),
    ingestedAt: isoTimestamp("ingested_at"),
  },
  (t) => ({
    unqHash: uniqueIndex("uq_statement_source_hash").on(t.sourceHash),
    idxAccount: index("idx_statement_account").on(t.accountId),
  }),
);

/**
 * Canonical ledger — one row per real-world money movement.
 *
 * Fields here are the merged best-known values across all sources that
 * observed this movement. Per-source raw data lives in `transaction_sources`.
 *
 * Merge policy (enforced by ingestion code, not the schema): prefer the most
 * specific non-null value from any source, except: if `reviewed=1`, never
 * overwrite `counterparty`, `category`, `person_id`, `shared_with`, or `notes`
 * (the fields a user typically edits manually).
 */
export const transactions = sqliteTable(
  "transactions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    accountId: integer("account_id")
      .references(() => accounts.id)
      .notNull(),
    /** ISO YYYY-MM-DD. Best-known date across sources. */
    txnDate: text("txn_date").notNull(),
    /** HH:MM (24h). NULL when only date-resolution sources have observed this txn. */
    txnTime: text("txn_time"),
    valueDate: text("value_date"),
    /** Bank's verbatim narration when any bank source saw this txn. */
    narration: text("narration"),
    /** UTR / UPI ref / NEFT ref — primary cross-source join key. */
    refNo: text("ref_no"),
    /** Outgoing amount (INR, positive); NULL for credits. */
    withdrawal: real("withdrawal"),
    /** Incoming amount (INR, positive); NULL for debits. */
    deposit: real("deposit"),
    /** Bank running balance (savings only). */
    closingBalance: real("closing_balance"),
    /** Best-known counterparty name, preferring PhonePe/GPay clean strings over raw bank narration. */
    counterparty: text("counterparty"),
    /** 'named' | 'vpa' | 'bill' | 'self_transfer' | 'unknown' — from PhonePe/GPay parsers. */
    counterpartyKind: text("counterparty_kind"),
    /** Resolved identity from the people registry. */
    personId: text("person_id"),
    category: text("category"),
    categoryRule: text("category_rule"),
    /** CSV of person ids: "rahul,shivam". */
    sharedWith: text("shared_with"),
    /** Share count INCLUDING me. share_count=3 → 3-way split. */
    shareCount: integer("share_count").notNull().default(1),
    notes: text("notes"),
    /** 1 = user has reviewed/edited this row; ingestion merger must not overwrite user-edited fields. */
    reviewed: integer("reviewed", { mode: "boolean" }).notNull().default(false),
    /**
     * How often this kind of expense repeats. NULL = not yet classified.
     * Enum values (app-enforced): 'one_time' | 'monthly' | 'weekly' |
     * 'quarterly' | 'yearly'. Used by the review drawer's recurrence
     * picker + future filters / charts.
     */
    recurrence: text("recurrence"),
    /**
     * Self-FK linking two canonical transactions that represent two ledger
     * entries of one cross-account money movement (canonical case: a HDFC CC
     * AUTOPAY debit on the savings account ↔ the matching AUTOPAY PAYMENT
     * credit on the credit-card account). Set symmetrically by the autopay
     * linker so either side can find its counterpart with a single FK join.
     * NULL until the linker has matched a counterpart, or for transactions
     * that don't participate in cross-account flows (the common case).
     */
    linkedTxnId: integer("linked_txn_id"),
    createdAt: isoTimestamp("created_at"),
    updatedAt: isoTimestamp("updated_at"),
  },
  (t) => ({
    idxDate: index("idx_txn_date").on(t.txnDate),
    idxAccount: index("idx_txn_account").on(t.accountId),
    idxCategory: index("idx_txn_category").on(t.category),
    idxRefNo: index("idx_txn_ref_no").on(t.refNo),
    idxPerson: index("idx_txn_person").on(t.personId),
    /** Powers SmartSuggest's merchant history aggregation. */
    idxCounterparty: index("idx_txn_counterparty").on(t.counterparty),
  }),
);

/**
 * Per-source observations. Many-to-one with `transactions` — each row records
 * that one statement saw this transaction, with its raw fields verbatim in
 * `rawJson` for full traceability and future re-derivation.
 *
 * The UNIQUE(statement_id, source_row_idx) constraint makes ingestion idempotent:
 * re-importing the same PDF cannot double-insert.
 */
export const transactionSources = sqliteTable(
  "transaction_sources",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    transactionId: integer("transaction_id")
      .references(() => transactions.id)
      .notNull(),
    /** Mirror of statements.sourceType for fast filtering without a join. */
    sourceType: text("source_type").notNull(),
    statementId: integer("statement_id")
      .references(() => statements.id)
      .notNull(),
    /** 0-based row index within the source PDF. */
    sourceRowIdx: integer("source_row_idx").notNull(),
    /** Source's own identifier (UTR for bank, PhonePe transactionId, Zomato order id, etc.). */
    sourceTxnId: text("source_txn_id"),
    /** The full source row as JSON — keeps per-source extras (splitSourceRaw, items, rewards, ...) without schema migrations. */
    rawJson: text("raw_json").notNull(),
    ingestedAt: isoTimestamp("ingested_at"),
  },
  (t) => ({
    unqSourceRow: uniqueIndex("uq_source_statement_row").on(t.statementId, t.sourceRowIdx),
    idxTransaction: index("idx_source_transaction").on(t.transactionId),
    idxSourceTxnId: index("idx_source_txn_id").on(t.sourceTxnId),
  }),
);

export const people = sqliteTable("people", {
  id: text("id").primaryKey(),
  displayName: text("display_name").notNull(),
  /** JSON array of regex strings — patterns to match this person in narrations / counterparty strings. */
  upiPatternsJson: text("upi_patterns_json"),
  createdAt: isoTimestamp("created_at"),
});

/**
 * User-supplied "what is this charge really" annotation. Resolves opaque
 * merchant strings (canonical case: "APPLE MEDIA SERVICES") to a specific
 * product the user recognizes ("iCloud+ 200GB").
 *
 * Keyed on (counterparty, amount_inr). Same merchant at a different price is
 * a different product — ₹59 vs ₹99 vs ₹159 Apple charges are not the same
 * subscription. A NULL `amount_inr` row is a fallback that applies to any
 * amount for that counterparty.
 *
 * Local to this device — no sync. Wiping browser data wipes labels. The
 * SmartSuggest pipeline merges these in at read-time; nothing in the
 * ingestion pipeline writes here.
 */
export const merchantLabels = sqliteTable(
  "merchant_labels",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    /** Exact match against `transactions.counterparty`. */
    counterparty: text("counterparty").notNull(),
    /** Amount in INR (rounded to nearest rupee). NULL = applies to any amount. */
    amountInr: integer("amount_inr"),
    /** User-friendly product name, e.g. "iCloud+ 200GB". */
    label: text("label").notNull(),
    /**
     * Optional category suggestion (e.g. "Subscriptions") — the SmartSuggest
     * will fill the category slot with this when no category is set yet. The
     * user still has to accept.
     */
    categoryHint: text("category_hint"),
    /**
     * Override for the "is this an online merchant" heuristic that decides
     * whether to attempt location inference. NULL = fall back to the
     * built-in merchant-hints KB (Apple/Google/Netflix etc. count as online).
     * 1 = always online (never infer location). 0 = always physical
     * (always try to infer). Set by the user from the location chip UI for
     * the long tail of merchants the KB doesn't know.
     */
    isOnline: integer("is_online", { mode: "boolean" }),
    createdAt: isoTimestamp("created_at"),
    updatedAt: isoTimestamp("updated_at"),
  },
  (t) => ({
    /**
     * UPSERT key. SQLite treats NULL as distinct in unique indexes, so the
     * NULL-amount fallback row coexists peacefully with per-amount rows.
     */
    unqKey: uniqueIndex("uq_merchant_label_key").on(t.counterparty, t.amountInr),
  }),
);

/**
 * Google Maps Timeline ingestion provenance. One row per Takeout export
 * the user has imported. Hash of the source bytes is the idempotency key —
 * re-uploading the same export returns the existing row.
 */
export const locationImports = sqliteTable(
  "location_imports",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    /** SHA-256 hex of the source bytes (zip or json). */
    takeoutHash: text("takeout_hash").notNull(),
    /** Earliest UTC timestamp covered by this import. ISO 8601. */
    periodFrom: text("period_from"),
    /** Latest UTC timestamp covered by this import. ISO 8601. */
    periodTo: text("period_to"),
    /** Number of downsampled raw GPS rows written. */
    recordCount: integer("record_count").notNull(),
    /** Number of semantic placeVisit rows written. */
    semanticCount: integer("semantic_count").notNull(),
    importedAt: isoTimestamp("imported_at"),
  },
  (t) => ({
    unqHash: uniqueIndex("uq_loc_import_hash").on(t.takeoutHash),
  }),
);

/**
 * One row per downsampled GPS ping or per semantic placeVisit stay.
 * `window_end_utc` is non-null only for semantic stays (the duration the
 * user was at that place). For raw pings, treat `timestamp_utc` as the
 * only time signal.
 *
 * The SmartSuggest "where were you when this charge happened" inference
 * reads from this table, never writes — wiping a row never has cascading
 * effects on transactions.
 */
export const locationRecords = sqliteTable(
  "location_records",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    /**
     * ISO 8601 UTC. For semantic stays this is the start of the stay; for
     * raw pings it's the moment the ping was recorded.
     */
    timestampUtc: text("timestamp_utc").notNull(),
    /** ISO 8601 UTC. Non-null for semantic stays only. */
    windowEndUtc: text("window_end_utc"),
    lat: real("lat").notNull(),
    lng: real("lng").notNull(),
    /** Meters. Null for semantic stays and pings without an accuracy reading. */
    accuracyM: integer("accuracy_m"),
    /** Google's friendly name when known. NULL for raw pings. */
    placeName: text("place_name"),
    /** Stable Google Place ID. NULL for raw pings. */
    placeId: text("place_id"),
    /** Google's taxonomy bucket ("RESTAURANT", "TYPE_GYM", ...). NULL for raw pings. */
    placeCategory: text("place_category"),
    /** 'takeout_raw' | 'takeout_semantic'. */
    sourceKind: text("source_kind").notNull(),
    importId: integer("import_id")
      .references(() => locationImports.id, { onDelete: "cascade" })
      .notNull(),
    importedAt: isoTimestamp("imported_at"),
  },
  (t) => ({
    idxTs: index("idx_loc_ts").on(t.timestampUtc),
    /** Covers semantic-stay "contains this timestamp" queries efficiently. */
    idxWindow: index("idx_loc_window").on(t.timestampUtc, t.windowEndUtc),
  }),
);

export const rules = sqliteTable(
  "rules",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    pattern: text("pattern").notNull(),
    category: text("category").notNull(),
    priority: integer("priority").notNull().default(100),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    /** 1 = user-created rule; 0 = default rule shipped with the app. */
    custom: integer("custom", { mode: "boolean" }).notNull().default(false),
    createdAt: isoTimestamp("created_at"),
  },
  (t) => ({
    idxPriority: index("idx_rule_priority").on(t.priority),
  }),
);

// ============================================================================
// Inferred types
// ============================================================================

export type Account = typeof accounts.$inferSelect;
export type NewAccount = typeof accounts.$inferInsert;
export type Statement = typeof statements.$inferSelect;
export type NewStatement = typeof statements.$inferInsert;
export type Transaction = typeof transactions.$inferSelect;
export type NewTransaction = typeof transactions.$inferInsert;
export type TransactionSource = typeof transactionSources.$inferSelect;
export type NewTransactionSource = typeof transactionSources.$inferInsert;
export type Person = typeof people.$inferSelect;
export type Rule = typeof rules.$inferSelect;
export type MerchantLabel = typeof merchantLabels.$inferSelect;
export type NewMerchantLabel = typeof merchantLabels.$inferInsert;
export type LocationImport = typeof locationImports.$inferSelect;
export type NewLocationImport = typeof locationImports.$inferInsert;
export type LocationRecord = typeof locationRecords.$inferSelect;
export type NewLocationRecord = typeof locationRecords.$inferInsert;
