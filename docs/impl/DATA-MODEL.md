# Data model — schema, source types, raw_json shapes

> The canonical ledger is one SQLite file (`splitlens.sqlite`). The shape is
> small, the conventions are strict, and the per-source `raw_json` payload
> is what most new work touches.

## Quick map

```
accounts ─< statements ─< transaction_sources >─ transactions
                                                      │
                                  shared_with CSV ────┤
                                                      │
                                            person_id ─→ people
                                                      │
                                              category ─→ rules (advisory)
```

Five tables. Three relationships. That's the entire schema.

## Tables (source of truth: `packages/db/src/schema.ts`)

### `accounts`

One row per bank account (HDFC savings X1234, HDFC CC X5678, PhonePe wallet, …).

| Column | Notes |
|---|---|
| `id` (PK) | int autoincrement |
| `bank` | `HDFC`, `ICICI`, `AXIS`, `PhonePe` (wallet pseudo-bank) |
| `type` | `savings`, `credit_card`, `phonepe_wallet`, `gpay_wallet` |
| `last4` | string — last 4 digits of acct / card |
| `customer_name` | nullable |
| `created_at` | ISO timestamp |

**Uniqueness:** `(bank, type, last4)` — one account per real-world card/acct.

### `statements`

One row per **ingested file** (or synthetic statement for email / OCR / forced attachment).

| Column | Notes |
|---|---|
| `id` (PK) | int |
| `account_id` (FK → accounts) | non-null |
| `source_file` | **absolute** path on disk |
| `source_hash` | SHA-256 of file bytes — **unique** index (dedup re-imports) |
| `source_type` | snake_case enum string (see table below) |
| `period_from`, `period_to` | ISO date — nullable; bank statements have them, email-derived ones don't |
| `page_count`, `txn_count` | metrics, both nullable |
| `ingested_at` | ISO timestamp |

The `uq_statement_source_hash` is what makes re-dropping the same file
return `skipped_duplicate` instead of double-writing.

### `transactions` — the canonical ledger

**One row per real-world money movement.** This is what every UI reads
and what every analytics query aggregates.

| Column | Notes |
|---|---|
| `id` (PK) | int |
| `account_id` (FK → accounts) | non-null |
| `txn_date` | ISO YYYY-MM-DD — required |
| `txn_time` | HH:MM 24h — nullable. Bank PDFs only have dates; email backfill fills this from HDFC InstaAlerts |
| `value_date` | ISO — nullable (savings only) |
| `narration` | bank's verbatim line (preserved exactly) |
| `ref_no` | UTR / UPI ref / NEFT ref. **Primary cross-source join key.** |
| `withdrawal`, `deposit` | REAL — exactly one non-null per row (debit XOR credit) |
| `closing_balance` | REAL — savings only |
| `counterparty` | best-known clean name. Reviewer can edit; rules try to populate |
| `counterparty_kind` | `named`, `vpa`, `bill`, `self_transfer`, `unknown` |
| `person_id` (→ people.id) | nullable — link to a person in the registry |
| `category` | colon-namespaced free-text (`Food:Restaurant`, `Bills:Rent`) |
| `category_rule` | which rule applied — nullable; null after user edits |
| `shared_with` | CSV of `person.id` — drives friends UI |
| `share_count` | int — total people in split (incl. you). `1` = not shared |
| `notes` | free-form user notes |
| `reviewed` | boolean — **edit protection flag**; ingestion can't overwrite user-edited fields when 1 |
| `linked_txn_id` (→ transactions.id) | self-FK for autopay pairs (savings AUTOPAY debit ↔ CC AUTOPAY PAYMENT credit) |
| `created_at`, `updated_at` | ISO timestamps |

#### Merge policy

When a new source observes a txn that already exists (matched by `ref_no`):
- **Always merge:** `narration`, `txn_time`, `value_date`, `closing_balance` (fill when null)
- **Conditionally merge:** `counterparty`, `category`, `category_rule` — only when `reviewed = 0`
- **Never auto-merge:** `person_id`, `shared_with`, `share_count`, `notes`, `reviewed`

Logic lives in `packages/ingest/src/merger.ts`.

### `transaction_sources`

**Many-to-one with transactions.** Records that one source has observed
this canonical txn, with its raw fields verbatim.

| Column | Notes |
|---|---|
| `id` (PK) | int |
| `transaction_id` (FK → transactions) | non-null |
| `source_type` | mirror of `statements.source_type` |
| `statement_id` (FK → statements) | non-null |
| `source_row_idx` | 0-based row in the source file (or canonical id for force-attach) |
| `source_txn_id` | source's own ID — UTR for bank, PhonePe txn id, Zomato order id, … |
| `raw_json` | TEXT — **the full source row as JSON**, see shapes below |
| `ingested_at` | ISO timestamp |

**Uniqueness:** `(statement_id, source_row_idx)` — same statement row can't double-insert.

### `people`

In-code registry — `DEFAULT_PEOPLE` in `packages/core/src/people/index.ts`.
The table mirrors the registry for FK validity; adding a person today
means editing code, not the DB.

### `rules`

Categorization rules; default set in `packages/core/src/rules/default-rules.ts`.
`pattern` is a regex string applied to narration; first match wins by priority.

## Source types — complete catalog

Every `transaction_sources.source_type` value, what produces it, and the
shape of its `raw_json`. Adding a new source type means:
1. Picking a stable snake_case name
2. Updating per-type code paths: classifier (if PDF), orchestrator,
   source-card icon (`apps/web/src/components/review/sourceFormat.ts:ICON_BY_TYPE`),
   title (`TITLE_BY_TYPE`), and a formatter function.

| `source_type` | Produced by | Shape of `raw_json` |
|---|---|---|
| `phonepe` | `ingestPhonePe` (parses PhonePe transaction statement) | `{ txnDate, txnTime, direction, counterparty, amount, utr, transactionId, sourceAccountLast4, kind, splitSourceRaw?, sourceRowIdx }` |
| `gpay` | `ingestGpay` (placeholder; not implemented) | same shape as phonepe (planned) |
| `hdfc_savings` | `ingestHdfcSavings` | `{ txnDate, valueDate, narration, refNo, withdrawal, deposit, closingBalance, sourceRowIdx }` |
| `hdfc_cc` | `ingestHdfcCc` | `{ txnDate, txnTime?, description, amount, isPayment, isInternational, isCharge, rewardPoints?, foreignAmount?, foreignCurrency?, sourceRowIdx }` |
| `hdfc_fd` | (recognized by classifier, no orchestrator) | n/a — file gets archived to `archive/hdfc-fd/`, no DB write |
| `swiggy_email` | `backfillSwiggyZomatoItems` | `{ extractorId, kind ("food_delivery"\|"instamart"), orderId, restaurant?, amount, items: [{qty, name, price?}], emailDate, summary }` |
| `zomato_email` | `backfillSwiggyZomatoItems` | same shape as swiggy_email; `kind` is `zomato_delivery` or `zomato_dining` |
| `zepto_invoice` | `ingestZeptoInvoice` (positional PDF parse) | `{ orderNo, invoiceNo, date, amount, items: [{seq, name, qty, amount}] }` |
| `zepto_ocr` | screenshot OCR + `zeptoParser.extract()` | `{ merchant: "zepto", amount, orderId, items: [{name, quantity, amount}], rawLines: string[] }` |
| `blinkit_ocr` | screenshot OCR + `blinkitParser.extract()` | same shape as zepto_ocr; `merchant: "blinkit"` |
| `instamart_ocr` | screenshot OCR + `instamartParser.extract()` | same shape; `merchant: "instamart"` |
| `manual_attachment` | `attachBillToTransaction` (review-page force-attach when no parser matches) | `{ fileName, mimeType, fileSize, ocrLines?: string[], ocrError? }` |
| `cred`, `swiggy`, `zomato` | reserved for future statement-file types | not yet emitted |

### Why `raw_json` matters

It's the **per-source source-of-truth**. We never lose information from
the parse — if a future iteration needs a field we don't lift to the
canonical row today, it's already in `raw_json` and we can backfill
from there. Formatters in `apps/web/src/components/review/sourceFormat.ts`
read straight from it.

## Identifiers + matching

### `ref_no` is the primary cross-source join key

- HDFC savings statement has UTR as `refNo`
- PhonePe statement has UTR
- HDFC alerts email have UTR in the body
- → `backfillTimesFromHdfcAlerts` joins on this exact string

The HDFC narration encodes the UTR with prefixes (`UPI-...-<UTR>-PAYMENT...`).
`canonicalRefForHdfc(narration)` (in `packages/ingest/src/hdfc-savings.ts`)
extracts the canonical UTR. **Tightened to skip UPIRET refunds** —
otherwise refunds match their original payments and produce false-positive merges.

### Sources that don't carry a UTR

- **`swiggy_email` / `zomato_email`** — joined to canonical txns by (date ±2d, amount ±₹2, counterparty contains "swiggy"/"zomato"). See `pickEmailMatches` in `packages/ingest/src/email-backfill.ts`.
- **`zepto_invoice`** — same idea: (date ±1d, amount ±₹2, counterparty/narration contains "zepto"). See `writeZeptoInvoiceEnrichment`.
- **Force-attach (`writeForcedAttachment`)** — bypasses matching entirely. Used by the /review page's bill-attach when the user has already picked which canonical txn.

## People registry

`packages/core/src/people/registry.ts`. In-code list (`DEFAULT_PEOPLE`)
of people with their identifying patterns:

```ts
interface Person {
  id: string;           // stable kebab-case slug
  displayName: string;
  relationship: string; // "flatmate", "family", "self"
  upiPatterns: string[];// regex strings to match VPAs / counterparties
  nameAliases?: string[];// alt names (lowercase or exact case)
}
```

Two identifier functions:
- `identifyPerson(counterpartyOrVpa)` — regex match on `upiPatterns`
- `identifyPersonByName(counterparty)` — case-insensitive exact + whole-word containment match on `nameAliases`

To add a flatmate, edit `registry.ts` and add their patterns. The DB
has no FK that prevents arbitrary `person_id` values; we validate at the
server-action level.

## Categorization rules

`packages/core/src/rules/default-rules.ts`. Each rule:

```ts
interface Rule {
  pattern: string;   // regex against narration (or `counterparty:<...>` form)
  category: string;  // "Bills:Rent" — colon-namespaced
  priority: number;  // higher = wins ties
  enabled: boolean;
  custom: boolean;   // false = shipped default, true = user-created
}
```

Applied during ingestion via `categorize(narration, rules)`. The chosen
rule is recorded in `transactions.category_rule` for traceability and is
**cleared** when the user manually changes the category (in `updateTransaction`).

Existing categories (37 distinct values today) live as actual strings in
the DB — sample:

```
Bills:Cooking Gas
Bills:Electricity
Bills:Loan EMI
Bills:Mobile/Internet
Bills:Rent
Bills:Rent (flatmate share)
Charges:Bank Fees
Charges:CC EMI Fee
Food:Cafe
Food:Delivery
Food:Groceries
Food:Quick Commerce
Food:Restaurant
Income:Salary (UsefulBI)
Investment:Equity
Investment:Fixed Deposit
Transfer:P2P
...
```

The web app's category dropdown auto-populates from these (sorted by usage).
