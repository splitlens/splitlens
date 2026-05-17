# Dev — conventions, recipes, gotchas, commands

> The "muscle memory" of working in this codebase. If you're about to write
> code, glance at the conventions first and the gotchas right before you ship.

## Commands

### Daily

```
pnpm install                       # workspace install (auto-builds better-sqlite3)
pnpm dev                           # turbo dev — runs daemon + web in parallel
pnpm --filter @splitlens/web dev   # web only (most common)
pnpm --filter @splitlens/daemon start
                                   # daemon in foreground (logs to stdout)
pnpm -r typecheck                  # workspace typecheck — run before every commit
pnpm -r test                       # workspace tests — vitest in core/db/ocr/email-receipts/ingest/daemon
```

### Bank-statement ingestion (CLI)

```
pnpm ingest <file.pdf>             # one-off ingest
pnpm ingest backfill-times         # HDFC alert email → txn_time backfill
pnpm ingest enrich-items           # Swiggy/Zomato email → items

# With passwords for password-protected PDFs:
PHONEPE_PWD=xxxx pnpm ingest <PhonePe_*.pdf>
HDFC_PWD=xxxx    pnpm ingest <Acct_Statement_*.pdf>
HDFC_CC_PWD=xxxx pnpm ingest <*_Billedstatements_*.pdf>
```

### macOS Vision OCR binary

```
pnpm --filter @splitlens/ocr build:swift   # builds packages/ocr/bin/splitlens-vision
                                           # needs: xcode-select --install
```

### Launchd (production "deploy")

```
pnpm --filter @splitlens/daemon install-launchd     # prompts for passwords, builds plist, loads via launchctl
pnpm --filter @splitlens/daemon uninstall-launchd   # tear down
tail -f apps/daemon/logs/daemon.out.log             # live log
```

### Email account env vars

```
GMAIL_USER_1=you@gmail.com
GMAIL_APP_PWD_1=xxxx xxxx xxxx xxxx        # Google App Password (16 chars, not your real pwd)
GMAIL_USER_2=...                            # up to 4 accounts (_1, _2, _3, _4)
```

### Git workflow

We rebase against `origin/main`. Worktrees per task — see top-level
`.claude/worktrees/` (auto-managed).

```
git log --oneline -20              # recent commits
git status                         # before staging
git diff --stat                    # what's about to be staged
# commit with HEREDOC + Co-Authored-By footer (see project commit convention)
```

## Conventions

### File / module layout

| Where | What |
|---|---|
| `packages/core/src/parsers/<merchant>.ts` | Pure parser. Bytes → ParseResult. No I/O. |
| `packages/core/src/{people,rules,settlement}/` | Pure domain logic. No DB. |
| `packages/ingest/src/<source>.ts` | Orchestrator. `ingestX(file, db)` + `writeXIngest({db, parsed, ...})` split. |
| `packages/email-receipts/src/extractors/<merchant>.ts` | Pure email-content extractor. |
| `apps/web/src/app/<route>/page.tsx` | Server component. Reads URL params, calls repo, hands to client component. |
| `apps/web/src/app/<route>/actions.ts` | Server actions. `"use server"` at top. |
| `apps/web/src/components/<feature>/<Component>.tsx` | Client components grouped by feature. |
| `apps/web/src/lib/<thing>.ts` | Shared client-side or server-only helpers. |

### Naming

- **Files:** `kebab-case.ts` for helpers/parsers, `PascalCase.tsx` for React components.
- **Functions:** `camelCase`. Prefix with verb (`parse…`, `format…`, `write…`, `ingest…`).
- **Source types:** `lowercase_snake_case` strings.
- **Person IDs:** kebab-case slugs (`rahul`, `mayank-wali`).

### Pure-function-first

Anything that's pure (no I/O, no DB, no React) goes in:
- `@splitlens/core` if it's data/domain
- A `lib/<thing>.ts` file inside `apps/web/src/lib/` if it's UI-adjacent

This makes things testable + safe to import from anywhere.

### Orchestrator pattern: `ingestX` + `writeXIngest`

```ts
// reads file, calls parser, calls writer
export async function ingestX(filePath, db, opts) {
  const bytes = await readFile(filePath);
  const sourceHash = sha256(bytes);
  if (await alreadyIngested(db, sourceHash)) return { status: "skipped_duplicate", sourceHash };
  const parsed = parseX(bytes, opts.password);
  return writeXIngest({ db, parsed, sourceFile: filePath, sourceHash, pageCount: parsed.pages });
}

// pure DB write — testable with synthetic ParseResult
export function writeXIngest({ db, parsed, sourceFile, sourceHash, pageCount }) {
  // INSERT into statements + transactions + transaction_sources in one tx
}
```

Tests can drive `writeXIngest` directly without a real PDF. See
`packages/ingest/tests/hdfc-cc.test.ts` for the canonical example.

### Server-action pattern (Next.js 15)

```ts
"use server";
import "server-only";
import { sql } from "drizzle-orm";
import { openDb } from "@splitlens/db";
import { revalidatePath } from "next/cache";

export async function myAction(args): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isValid(args)) return { ok: false, error: "invalid" };
  const db = openDb();
  db.run(sql`UPDATE … WHERE …`);
  revalidatePath("/relevant-route");
  return { ok: true };
}
```

**Every export from a `"use server"` file MUST be a directly-defined
async function.** You cannot re-export. (See Gotchas.)

### Test patterns

- **vitest** in every package, including the daemon.
- Tests live in `<package>/tests/` (not co-located).
- DB tests use `mkdtempSync(...) + openDb(join(tmp, "db.sqlite"))` for isolation.
- Fixtures (real PDF byte content for parser tests) live in `<package>/tests/fixtures/`.
- **Don't test the orchestrator's file I/O.** Test the writer half (`writeXIngest`) with synthetic ParseResult.

Test count: 286 across 8 vitest projects (as of `85d71c2`).

### Error handling

- **Server actions:** discriminated return — never throw to the client.
- **Daemon handlers:** wrap in try/catch, log, route file to `unparsed/`, write `.error.log`. **Never let the daemon crash.**
- **Pure parsers:** return `null` for "can't parse this" rather than throw. Throw only on programmer errors.

### Conventional commits

Format: `feat(scope): summary`, `fix(scope): summary`, `chore(scope): summary`.
Scopes seen in this branch: `data`, `daemon`, `web`, `email`, `ocr`, `invoices`.
Body explains the WHY, not the WHAT. Reference commits with short hash.

## Recipes

### Recipe 1: Add a new bank PDF parser

End-to-end steps:

1. **Pure parser** in `packages/core/src/parsers/<bank>-<type>.ts`:
   ```ts
   export function parseFooBar(pages: string[]): ParseResult { ... }
   ```
   Take pages (or positional words) in, return `ParseResult` (see `packages/core/src/types/index.ts`).

2. **Re-export** from `packages/core/src/parsers/index.ts`.

3. **Filename pattern** in `packages/ingest/src/classify.ts`:
   ```ts
   const FOOBAR_RE = /^FooBar_Statement_\d{8}\.pdf$/i;
   // …
   if (FOOBAR_RE.test(name)) return { sourceType: "foobar" };
   ```

4. **Source type** in the same file:
   ```ts
   export type SourceType = ... | "foobar";
   ```

5. **Orchestrator** in `packages/ingest/src/foobar.ts` (use existing as templates):
   ```ts
   export async function ingestFooBar(file, db, opts) { ... }
   export function writeFooBarIngest({ db, parsed, ...}) { ... }
   ```

6. **Re-export** from `packages/ingest/src/index.ts`.

7. **Dispatch case** in `packages/ingest/src/dispatch.ts`:
   ```ts
   case "foobar":
     result = await ingestFooBar(filePath, db, { password: process.env.FOOBAR_PWD });
     break;
   ```

8. **Daemon archive dir** in `apps/daemon/src/paths.ts`:
   ```ts
   const ARCHIVE_DIR_BY_SOURCE = { ..., foobar: "archive/foobar" };
   ```

9. **UI formatter** in `apps/web/src/components/review/sourceFormat.ts` —
   add `ICON_BY_TYPE.foobar`, `TITLE_BY_TYPE.foobar`, and a `formatFooBar()`
   case in the switch. The default `formatGeneric` works as a placeholder.

10. **Test** — drive `writeFooBarIngest` from `packages/ingest/tests/foobar.test.ts`
    with a synthetic ParseResult.

### Recipe 2: Add a new email extractor

1. **Extractor** in `packages/email-receipts/src/extractors/<merchant>.ts`:
   ```ts
   export const myMerchantExtractor: MerchantExtractor = {
     id: "mymerchant",
     senders: ["receipts@mymerchant.com"],
     extract(email) {
       // parse email.text or htmlToPlain(email.html)
       return { fields: { ... }, summary: "..." };
     },
   };
   ```

2. **Register** in `packages/email-receipts/src/extractors/index.ts`:
   - Export it
   - Add to `DEFAULT_EXTRACTORS`

3. **Test** in `packages/email-receipts/tests/extractors/<merchant>.test.ts`.

4. If it produces a new source type (e.g. `mymerchant_email`), follow
   Recipe 1 steps 9 + the orchestration recipe below.

### Recipe 3: Add a new source type to the /review source card

If you've created a new `source_type` and want it to render nicely:

1. **Icon + title** in `apps/web/src/components/review/sourceFormat.ts`:
   ```ts
   const ICON_BY_TYPE = { ..., my_source: "🎯" };
   const TITLE_BY_TYPE = { ..., my_source: "My friendly title" };
   ```

2. **Formatter function** in the same file:
   ```ts
   function formatMySource(raw: Record<string, unknown>): FormattedSource {
     const someField = asString(raw.someField);
     const chips: SourceChip[] = [...];
     const details: SourceDetailRow[] = [...];
     return {
       icon: ICON_BY_TYPE.my_source!,
       title: TITLE_BY_TYPE.my_source!,
       subtitle: someField,
       chips,
       details,
       items: null,        // or populate if your source has items
       ocrLines: null,     // or populate if it has OCR text (renders via <OcrPreview>)
     };
   }
   ```

3. **Wire it** in `formatSource()` switch:
   ```ts
   case "my_source":
     return formatMySource(rawJson);
   ```

4. **Item enrichment** — if this source carries items that should surface
   on `/dashboard` / `/friends`, update `parseItemEnrichment` in
   `apps/web/src/lib/repo.ts` to recognize the new shape.

### Recipe 4: Add a Next.js page with URL-state filters

Pattern: server component reads search params, fetches data, hands to
client component that owns `router.replace` for state changes.

1. **Page** at `apps/web/src/app/<route>/page.tsx`:
   ```tsx
   export const dynamic = "force-dynamic";   // search-param-driven, never cache

   export default async function Page({ searchParams }) {
     const sp = await searchParams;
     const filter = readFilterFromParams(sp);
     const [list, meta] = await Promise.all([ ... ]);
     return <MyLayout filter={filter} list={list} meta={meta} />;
   }
   ```

2. **Client root** with `useRouter` + `useSearchParams`:
   ```tsx
   "use client";
   const router = useRouter();
   const params = useSearchParams();
   const setFilter = (patch) => {
     const next = new URLSearchParams(params?.toString() ?? "");
     for (const [k, v] of Object.entries(patch)) {
       if (v === null) next.delete(k);
       else next.set(k, String(v));
     }
     startTransition(() => router.replace(`/<route>?${next}`, { scroll: false }));
   };
   ```

3. **Filter type** in your repo file — keep it small + serializable.

### Recipe 5: Add a server action

1. **File** `apps/web/src/app/<route>/actions.ts`:
   ```ts
   "use server";
   import "server-only";
   import { sql } from "drizzle-orm";
   import { openDb } from "@splitlens/db";
   import { revalidatePath } from "next/cache";

   export async function doTheThing(arg1: number, arg2: string): Promise<
     { ok: true; result: ... } | { ok: false; error: string }
   > {
     // 1. Validate
     if (!Number.isInteger(arg1)) return { ok: false, error: "invalid arg1" };
     // 2. Execute
     const db = openDb();
     db.run(sql`UPDATE ... WHERE ...`);
     // 3. Invalidate caches
     revalidatePath("/<route>");
     revalidatePath("/dashboard");
     // 4. Return
     return { ok: true, result: ... };
   }
   ```

2. **Invoke from client component**:
   ```ts
   import { doTheThing } from "@/app/<route>/actions";
   const r = await doTheThing(1, "x");
   if (!r.ok) setError(r.error);
   ```

3. **Caveats** — read Gotchas below.

### Recipe 6: Add a categorization rule

`packages/core/src/rules/default-rules.ts`:

```ts
export const DEFAULT_RULES: Rule[] = [
  ...
  {
    pattern: "(?i)\\b(my_merchant_keyword)\\b",
    category: "Food:My Subcategory",   // colon-namespaced
    priority: 100,
    enabled: true,
    custom: false,
  },
];
```

Test by running `packages/core/tests/rules/default-rules.test.ts` —
add a case for the merchant keyword + expected category.

## Gotchas

A running list of things that bit us. Future Claude: read this before
debugging anything weird.

### TS literal-type inference + `.filter(predicate)`

Building an array of conditional objects then filtering nulls:

```ts
const rows: SourceDetailRow[] = [
  someValue ? { label, value } : null,
  ...
].filter((r): r is SourceDetailRow => r !== null);  // ❌ TS error
```

TS infers the literal as a too-narrow union and the type predicate
fails. **Fix:** cast the array literal to a nullable shape *before*
filtering:

```ts
const rows: SourceDetailRow[] = ([
  someValue ? { label, value } : null,
  ...
] as Array<SourceDetailRow | null>).filter((r): r is SourceDetailRow => r !== null);  // ✓
```

### Drizzle: use `db.$client`, not `db.$raw`

To reach the underlying `better-sqlite3` handle for pragmas / `db.close()`:

```ts
(db as unknown as { $client: Database }).$client  // ✓
db.$raw                                            // ❌ doesn't exist
```

We expose `closeDb(db)` helper in `@splitlens/db` so callers don't need to know.

### better-sqlite3 native binding

Node 25.x may not have prebuilts. If you see "binding not found":

```
cd node_modules/.pnpm/better-sqlite3@*/node_modules/better-sqlite3
npm run install
```

Also: turbopack ignores `serverExternalPackages`. We use webpack (not
turbo) for the web app — `next.config.ts` has explicit `webpack`
externals for `better-sqlite3` + `bindings`. Don't add `--turbopack`
to the dev script.

### pdfjs-dist transfers the ArrayBuffer

After `pdfjs.getDocument({ data: bytes })`, the input `bytes` is unusable
(transferred to a worker). If you need to read the file twice (text +
positional), call `readFile` twice. Don't reuse the same `Uint8Array`.

### Multi-page positional extraction needs page-aware row grouping

Don't flat-sort word coordinates across pages — page 2's y-coords reset
and would interleave with page 1's. See `groupIntoRows()` in
`packages/core/src/parsers/zepto-invoice.ts` for the pattern: process
pages in order, group rows per-page, then concatenate.

### Server actions: no re-exports

```ts
// ❌ Next.js rejects this
"use server";
export { markReviewed } from "../reports/actions";
```

Must duplicate the body:

```ts
// ✓
"use server";
export async function markReviewed(txnId: number) { ... }
```

We duplicate `markReviewed` between `review/actions.ts` and
`reports/actions.ts` for this reason.

### Server actions: 1MB body limit by default

Bumped to 40MB in `next.config.ts` to handle 25MB image attachments
(base64 inflates ~33%):

```ts
experimental: { serverActions: { bodySizeLimit: "40mb" } }
```

### Unicode in filenames (especially macOS screenshots)

macOS uses **narrow no-break space** (`U+202F`, bytes `e2 80 af`) between
time and "AM"/"PM" in screenshot filenames:

```
Screenshot 2026-05-16 at 1.41.29 AM.png  ← that's NOT a regular space
```

A regular space won't match in shell tests. Use a glob:

```
ls ~/Downloads/Screenshot*1.41.29*.png
```

…or `find` with no exact-string match. Don't trust `[ -f "..." ]` against
a path containing one of these.

### Vision OCR is not deterministic on text layout

Vision joins text by reading order, not table-column order. For tables
(GST invoices, statement-like layouts) use the **positional** extractor
(`extractPagesPositional`) and reconstruct rows by y-coordinate. See the
Zepto-invoice parser for the algorithm.

### Vision misreads `₹` as `2` / `7` / `{` / `Z`

The rupee glyph is hostile to Vision's text engine. The screenshot
parsers strip a single non-digit prefix and validate the result is a
plausible amount (`>= 1`, `<= 99_999`). See `OcrPreview.classifyLine`
for the canonical pattern.

### `canonicalRefForHdfc` MUST skip UPIRET refunds

Otherwise a refund's UTR matches the original payment's row and we
get false-positive merges (refund's narration overwrites payment's,
items disappear, etc.). The fix:

```ts
narration.startsWith("UPI-") && !narration.startsWith("UPIRET-")
```

Tightened during the multi-source schema work.

### Tailwind dark mode + CSS variables

Don't use `dark:bg-white/40` directly — write it as
`dark:bg-zinc-900/40` or use the CSS variable
(`dark:bg-[color:var(--color-card)]`). The first variant doesn't get
the inverted color the user expects.

### Test isolation in DB tests

Every DB test that uses `openDb()` MUST use `mkdtempSync(...)` for
its file, otherwise tests poison each other's data. Pattern:

```ts
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "splitlens-test-"));
  db = openDb(join(tmp, "db.sqlite"));
});
afterEach(() => {
  closeDb(db);
  rmSync(tmp, { recursive: true, force: true });
});
```

### Daemon: process.exit on critical errors

If something inside the daemon `throw`s and isn't caught, the daemon dies
and launchd restarts it (or just stops, depending on plist). **All
chokidar handlers MUST be try/caught**. The error log routes failures
to `unparsed/` without crashing.

### Async-action lock on poll loops

`apps/daemon/src/poll.ts:schedulePoll` uses a single-flight token so two
email-poll cycles can't overlap. Don't use `setInterval` for anything
that can take > the interval to run.

### Form remount on row navigation

The `<ReviewForm key={activeDetail.id}>` is critical — without the
`key`, the form state from the previous row leaks into the next one and
the Save button thinks unchanged fields are dirty.

## Performance notes

Not bottlenecked anywhere right now (~5,800 txns, 6,500 sources, 286 tests
in ~3s). But:

- **`getTransactionForReview`** runs a JOIN against `statements` for the
  archive path. If sources grow to 100k+, consider materializing the
  archive path on the source row directly.
- **`buildTimelineColumns`** materializes the full calendar grid (30 day
  columns when zoomed to a month). Fine at 1-month scale, would need
  virtualization at year+ scale.
- **Sidebar list** caps at 500 rows via `filter.limit` clamp. The
  TimeNavigator's chip counts query the full table (count(*) per
  year/month/day) — fast on SQLite with the `idx_txn_date` index.

## Adding a new doc

If this `docs/impl/` set grows beyond 5–6 files, prefer adding sections
to existing docs over fragmenting further. The goal is fast context
loading per task — too many files defeats it.

If you add a new pipeline or source type, update:
- `DATA-MODEL.md` source-types table
- `PIPELINES.md` (a new section or the existing one)
- `README.md` "Read this next, by task" table
- the feature timeline in `README.md`
