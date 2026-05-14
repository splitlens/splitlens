/**
 * SplitLens database schema (Drizzle ORM, Postgres dialect — runs on PGlite in browser).
 *
 * Schema is intentionally narrow at v1: accounts, statements, transactions, people, rules.
 * The same schema is shared between web (PGlite/OPFS) and future mobile (expo-sqlite +
 * compatibility shim) builds. Only the driver changes.
 */
import {
  pgTable,
  serial,
  text,
  integer,
  real,
  timestamp,
  boolean,
  unique,
  index,
} from "drizzle-orm/pg-core";

export const accounts = pgTable(
  "accounts",
  {
    id: serial("id").primaryKey(),
    bank: text("bank").notNull(), // 'HDFC', 'ICICI', ...
    type: text("type").notNull(), // 'savings' | 'credit_card'
    last4: text("last4").notNull(),
    customerName: text("customer_name"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    unq: unique().on(t.bank, t.type, t.last4),
  }),
);

export const statements = pgTable("statements", {
  id: serial("id").primaryKey(),
  accountId: integer("account_id")
    .references(() => accounts.id)
    .notNull(),
  sourceFile: text("source_file").notNull().unique(),
  periodFrom: text("period_from"),
  periodTo: text("period_to"),
  pageCount: integer("page_count"),
  txnCount: integer("txn_count"),
  ingestedAt: timestamp("ingested_at").defaultNow().notNull(),
});

export const transactions = pgTable(
  "transactions",
  {
    id: serial("id").primaryKey(),
    accountId: integer("account_id")
      .references(() => accounts.id)
      .notNull(),
    statementId: integer("statement_id")
      .references(() => statements.id)
      .notNull(),
    txnDate: text("txn_date").notNull(), // ISO YYYY-MM-DD
    valueDate: text("value_date"),
    narration: text("narration").notNull(),
    refNo: text("ref_no"),
    withdrawal: real("withdrawal"),
    deposit: real("deposit"),
    closingBalance: real("closing_balance"),
    category: text("category"),
    categoryRule: text("category_rule"),
    sharedWith: text("shared_with"), // CSV of person ids: "rahul,shivam"
    shareCount: integer("share_count").default(1).notNull(),
    notes: text("notes"),
    reviewed: boolean("reviewed").default(false).notNull(),
    sourceRowIdx: integer("source_row_idx").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    unqSource: unique().on(t.statementId, t.sourceRowIdx),
    idxDate: index("idx_txn_date").on(t.txnDate),
    idxAccount: index("idx_txn_account").on(t.accountId),
    idxCategory: index("idx_txn_category").on(t.category),
  }),
);

export const people = pgTable("people", {
  id: text("id").primaryKey(), // 'rahul', 'shivam'
  displayName: text("display_name").notNull(),
  upiPatternsJson: text("upi_patterns_json"), // JSON array of regex strings
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const rules = pgTable(
  "rules",
  {
    id: serial("id").primaryKey(),
    pattern: text("pattern").notNull(),
    category: text("category").notNull(),
    priority: integer("priority").default(100).notNull(),
    enabled: boolean("enabled").default(true).notNull(),
    custom: boolean("custom").default(false).notNull(), // user-created vs default
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    idxPriority: index("idx_rule_priority").on(t.priority),
  }),
);

// Inferred types for use in app code
export type Account = typeof accounts.$inferSelect;
export type NewAccount = typeof accounts.$inferInsert;
export type Statement = typeof statements.$inferSelect;
export type Transaction = typeof transactions.$inferSelect;
export type NewTransaction = typeof transactions.$inferInsert;
export type Person = typeof people.$inferSelect;
export type Rule = typeof rules.$inferSelect;
