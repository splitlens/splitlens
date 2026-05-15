# UI — pages, components, server actions

> The Next.js 15 web app at `apps/web/`. App Router. Server Components by
> default. Server Actions for every mutation. Tailwind 4 with `dark:` variants
> + CSS variables.

## Top-level layout

```
apps/web/src/
├── app/
│   ├── layout.tsx              ← root layout: <TopNav /> + theme
│   ├── page.tsx                ← / (home / marketing)
│   ├── dashboard/
│   │   ├── page.tsx            ← /dashboard (11 widgets)
│   │   └── actions.ts          ← day-detail server actions
│   ├── review/
│   │   ├── page.tsx            ← /review (form-driven txn review)
│   │   └── actions.ts          ← updateTransaction, attachBillToTransaction, …
│   ├── friends/
│   │   ├── page.tsx            ← /friends (people overview)
│   │   ├── [personId]/page.tsx ← /friends/:id (per-person timeline)
│   │   ├── actions.ts          ← markShared, unmarkShared, listKnownPeople
│   │   └── email-lookup-actions.ts ← lookupEmailsForTxn
│   ├── reports/
│   │   ├── page.tsx            ← /reports (list)
│   │   ├── [yearMonth]/page.tsx← /reports/2026-05 (monthly ADHD review)
│   │   └── actions.ts          ← markReviewed / unmarkReviewed
│   └── try/page.tsx            ← /try (upload PDF — browser-side parsing demo)
├── components/
│   ├── TopNav.tsx              ← Home / Dashboard / Review / Reports / Friends / Upload
│   ├── PdfDropzone.tsx         ← bank-statement upload (used by /try)
│   ├── TransactionTable.tsx    ← reusable transaction list table
│   ├── dashboard/              ← 11 widget components
│   ├── friends/                ← FriendDetailTimeline, ShareTxnModal, EmailMatchModal, FindEmailsButton
│   ├── reports/                ← MonthReport, TxnReviewCard
│   └── review/                 ← the largest cluster — see below
└── lib/
    ├── repo.ts                 ← main read-side queries (dashboard, friends, reports)
    ├── review-repo.ts          ← read-side queries specific to /review
    ├── review-time.ts          ← pure date helpers for /review
    ├── narration.ts            ← extractCounterpartyFromNarration (pure)
    └── format.ts               ← fmtInr, fmtDate, etc.
```

## Pages — one-line description each

| Route | Purpose | Top component |
|---|---|---|
| `/` | Landing / marketing copy | `app/page.tsx` |
| `/dashboard` | 11-widget overview: KPIs, monthly trajectory, heatmap, recent txns, day-detail modal | `app/dashboard/page.tsx` |
| `/review` | Form-driven txn-by-txn review with timeline sidebar + bill attach. **Most complex surface.** | `app/review/page.tsx` |
| `/friends` | Per-person net-debt overview cards | `app/friends/page.tsx` |
| `/friends/[personId]` | Single-person activity timeline + share modal | `app/friends/[personId]/page.tsx` |
| `/reports` | List of months with quick links | `app/reports/page.tsx` |
| `/reports/[yearMonth]` | ADHD-friendly monthly review with smart buckets (house / chase / usual / other / done) | `app/reports/[yearMonth]/page.tsx` |
| `/try` | Browser-side PDF upload demo — parsing only, no DB write | `app/try/page.tsx` |

## /review — the most complex surface, mapped

This is where ~50% of recent commits land. Here's the sub-component tree
+ what each thing owns. **If you're touching /review, read this section
top to bottom.**

```
app/review/page.tsx                    ← server component, reads URL search params,
                                         fetches list/buckets/people/detail, hands
                                         everything to <ReviewLayout>

components/review/
├── ReviewLayout.tsx                   ← CLIENT root: owns URL-state sync (filters
│                                       + active id) + resizable sidebar +
│                                       keyboard nav glue
│
├── ReviewSidebar.tsx                  ← left pane — progress + active-filter chips
│                                       + collapsible time-pill + search + collapsible
│                                       "More filters" + LIST OR TIMELINE
│
├── ActiveFilterChips.tsx              ← removable indigo chips below progress meter
│                                       + "Clear all" link
│
├── TimeNavigator.tsx                  ← collapsible — year strip / month strip /
│                                       calendar day grid / time-of-day chips
│
├── TimelineColumns.tsx                ← horizontal-scroll columns view of the list
│                                       (kicks in at year-zoom or month-zoom)
├── buildTimelineColumns.ts            ← pure helper: rows + selection → columns
│
├── ReviewForm.tsx                     ← right pane — editable form. header
│                                       (date prominent, amount alongside) →
│                                       counterparty + category → sources →
│                                       collapsible "More fields" → collapsible
│                                       attach-bill → action footer
│
├── ReviewSourceCard.tsx               ← one card per transaction_sources row.
│                                       always-visible chips + click-to-expand for
│                                       full detail + items list + OcrPreview
│
├── sourceFormat.ts                    ← per-source-type formatter:
│                                       (source_type, raw_json) → FormattedSource
│                                       (icon, title, subtitle, chips, details, items,
│                                       ocrLines)
│
├── OcrPreview.tsx                     ← structured renderer for OCR lines:
│                                       Detected metadata + grouped item cards +
│                                       Raw toggle + Copy button
│
├── BillAttachDropzone.tsx             ← drag-and-drop; calls
│                                       attachBillToTransaction server action;
│                                       reports result via onAttached callback
│
└── useReviewKeyboard.ts               ← global keydown handler: J / K (prev/next)
                                         and N (next unreviewed). S / A live in
                                         ReviewForm (they need form state).
```

### URL state for /review

Filter state lives in the URL — every change rewrites params via
`router.replace(..., { scroll: false })`. Format:

```
/review?id=2656                  → pin to specific txn
       &from=2026-05-01          → date lower bound (ISO)
       &to=2026-05-31            → date upper bound (ISO)
       &category=Food:Restaurant → exact match
       &accountId=3              → numeric account FK
       &personId=rahul           → person link
       &q=zepto                  → free-text counterparty / narration search
       &unreviewed=true          → only unreviewed rows
       &tod=afternoon            → time-of-day bucket
       &sort=asc                 → chronological (default: desc)
```

Back/forward buttons just work. Shareable links Just Work.

### Resizable sidebar

`ReviewLayout` owns `sidebarWidth` state (default 540px, min 320, max 900).
Drag-resize via a 6px gutter handle. `localStorage` key
`splitlens.review.sidebarWidth`. Keyboard: tab to the handle + ←/→ to
nudge (Shift+←/→ for 96px steps). Double-click resets.

### Vertical-list vs Timeline-columns

The sidebar's queue area renders one of two layouts based on the time
selection:

| Selection | Layout | Each column = |
|---|---|---|
| No year / all-time | Vertical list with sticky day headers | a day |
| Year only | **Horizontal scroll** | a month |
| Year + month | **Horizontal scroll** | a day |
| + day | Vertical list | row (only one day's worth, ~20 rows max) |

Component: `TimelineColumns` (220px-wide columns, scroll-snap-x mandatory,
sticky header per column, auto-scroll active column into view).

### Keyboard shortcuts

| Key | Action | Where |
|---|---|---|
| `J` | Next row in visible list | `useReviewKeyboard` |
| `K` | Previous row in visible list | `useReviewKeyboard` |
| `N` | Next **unreviewed** row | `useReviewKeyboard` |
| `S` | Save current edits | `ReviewForm` (needs form state) |
| `A` | Save + mark reviewed (advances) | `ReviewForm` |

All shortcuts skip-firing when a typing element has focus
(`isTypingTarget()` helper).

## Server actions

Lives in `app/<route>/actions.ts` with `"use server"` at the top. Each
function is async and returns either:
- `{ ok: true, ...payload }` (success)
- `{ ok: false, error: string }` (validation / write failure)

Action files in the codebase:

| File | Owns |
|---|---|
| `app/review/actions.ts` | `updateTransaction`, `attachBillToTransaction`, `markReviewed`, `unmarkReviewed` |
| `app/friends/actions.ts` | `markShared`, `unmarkShared`, `listKnownPeople` |
| `app/friends/email-lookup-actions.ts` | `lookupEmailsForTxn` (synchronous IMAP search for a single txn) |
| `app/reports/actions.ts` | `markReviewed`, `unmarkReviewed` (duplicated for symmetry — see "Server-action gotchas") |
| `app/dashboard/actions.ts` | (day-detail interactions) |

### Pattern: revalidatePath after every write

Every action that writes the DB calls `revalidatePath("/<route>")` for
every UI that depends on it. Convention:

```ts
revalidatePath("/review");
revalidatePath("/dashboard");
revalidatePath("/reports", "layout");  // because /reports/[yearMonth] reuses layout
if (edits.personId) revalidatePath(`/friends/${edits.personId}`);
```

## Read-side queries — `lib/repo.ts` + `lib/review-repo.ts`

Two read-side modules:
- `lib/repo.ts` — used by `/dashboard`, `/friends`, `/reports` etc. Functions return view-model shapes.
- `lib/review-repo.ts` — used only by `/review`. Heavier joins (per-txn `transaction_sources` aggregation, time-bucket counts).

Both:
- Are `"server-only"` (the import at top ensures they can't be pulled into the client bundle).
- Open `openDb()` lazily on first call and reuse the handle module-wide.

### Common query helpers

| Function | Returns |
|---|---|
| `getDashboardSummary()` | KPI cards: total spend MTD, top category, etc. |
| `getRecentTransactions(limit)` | Recent rows with sharedWith/personId — used by drill-down |
| `getSpendByCategory(period)` | For the donut chart |
| `getMonthlyTrajectory()` | For the line chart |
| `getDailySpend()` | For the bar chart |
| `getTimeOfDayHeatmap()` | DoW × hour cells |
| `getFriendsOverview()` | Per-person net debt |
| `getFriendDetail(personId)` | Direct + shared txns, with item enrichment |
| `getMonthlyReport(yearMonth)` | Bucketed review queue (house / chase / usual / other / done) |
| `getTransactionsForDate(iso)` | For day-detail modal |
| **review-repo:** | |
| `listTransactionsForReview(filter)` | Sidebar list with totals + pagination |
| `getTransactionForReview(id)` | Full detail incl. source rows |
| `getTimeBuckets(filter)` | Year / month / day / tod counts for TimeNavigator |
| `getReviewFilterMeta()` | Categories + accounts dropdowns |
| `findNextUnreviewedAfter(id, filter)` | For Save+Next advancement |

### Item enrichment surfacing

`getItemEnrichmentsForTxns(ids)` in `repo.ts` loads every
`transaction_sources` row with `source_type IN ('swiggy_email',
'zomato_email', 'zepto_invoice')` and adapts its `raw_json` to a unified
`ItemEnrichment` view-model. Used by `FriendDetailTimeline` and
`DayDetailModal` to render inline `🛒 Restaurant · 3 items · ₹450`.

When you add a new source type that carries items, **update this function**
or items won't surface outside /review.

## Styling

Tailwind 4 with the `@import "tailwindcss"` model. Theme tokens via CSS
variables (defined in `apps/web/src/app/globals.css`):

```
--color-bg, --color-fg, --color-muted, --color-card, --color-border,
--color-accent, --color-accent-fg, --color-danger
```

Dark mode via `dark:` variants. The app respects `prefers-color-scheme`.

Common patterns:
- `text-[color:var(--color-muted)]` for secondary text
- `rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900` for cards
- `tabular-nums` for amounts (number alignment)
- `font-mono text-[10px]` for IDs / UTRs / hashes

## Form state — `useState` + diff tracking

`ReviewForm` is the reference pattern. Local `useState<FormState>`.
A `dirty` memo compares to `original` (computed from props). The Save
button is disabled when `!dirty`. The form key is the txn id, so React
remounts on navigation (clean state reset).

## Server-action gotchas

Two big ones — both bit me already:

1. **Cannot re-export from a `"use server"` module.** You can't write
   `export { markReviewed } from "../reports/actions";` inside another
   `"use server"` file. Each export must be a directly-defined async
   function. We duplicate the body in `review/actions.ts` for
   `markReviewed` / `unmarkReviewed`.

2. **Server-action body size limit is 1MB by default.** Bumped to 40MB
   via `next.config.ts` so 25MB image attachments (base64-encoded to
   ~33MB) round-trip cleanly:

   ```ts
   experimental: { serverActions: { bodySizeLimit: "40mb" } }
   ```

See [`DEV.md`](DEV.md) Gotchas section for more.

## UX conventions

Worth keeping in mind on every UI change:

- **ADHD-friendly defaults:** primary action = visible, smooth transitions
  between txns, auto-advance after save, no auto-save (anxiety pattern).
- **Save+Next is the primary blue button.** "Save" alone exists for the
  user who wants to keep going on the same row.
- **Inline status with auto-fade.** Toast pattern: ✓/⚠ message under the
  action bar, `setTimeout(() => setMsg(null), 1800)`. No portal.
- **Keyboard hints are visible** — sticky-noted in the form footer
  (`Kbd` component renders the keys).
- **Progressive disclosure** for rare fields. Person / Narration / Notes
  hide behind "▾ More fields" disclosure. Bill attach behind
  "+ Attach a bill / receipt".
- **Counterparty fallback.** When `transactions.counterparty` is null,
  show `extractCounterpartyFromNarration(narration)` so rows never read
  as `—`. The form offers an inline "Suggested" pill to accept the
  fallback with one click.
