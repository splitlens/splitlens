# Roadmap — SplitLens Phase 1 (Web MVP)

**Goal:** Public ProductHunt launch by Week 9.
**Owner:** Prateek Aryan, 15-30 hrs/week.
**Method:** TDD core, ship vertically (one full feature end-to-end per week).

## Week 0 — Setup (this week, ~10 hrs)

**Pre-code decisions:**

- [ ] Confirm name (default: SplitLens)
- [ ] Buy domain (`splitlens.app` or `splitlens.in`)
- [ ] Reserve handles: `@splitlens` on X, `splitlens` on GitHub, ProductHunt, Reddit
- [ ] Apply for Apple Developer account ($99, 1-2 wk turnaround)
- [ ] Apply for Google Play Console ($25)

**Sketches** (Figma, ~3-4 hrs total):

- [ ] Landing page hero + value prop
- [ ] Onboarding (drop PDF → see dashboard)
- [ ] Main dashboard (sunburst + table layout)
- [ ] Settlement view

**Repo init:**

- [ ] `pnpm create turbo@latest splitlens`
- [ ] Add `apps/web` (Next.js), `packages/core`, `packages/db`
- [ ] Configure ESLint + Prettier + Husky + commitlint
- [ ] Configure Vitest + Playwright + Storybook
- [ ] Configure GitHub Actions CI (lint, type, test, build)
- [ ] Push to private GitHub repo

## Week 1 — Foundation (15-20 hrs)

**Vertical slice:** Marketing landing page deployed.

- [ ] Next.js app boots, Tailwind + shadcn/ui set up
- [ ] Marketing landing: hero, problem, solution, screenshots placeholder, CTA "Try the demo"
- [ ] Privacy page with the wedge messaging
- [ ] Plausible installed
- [ ] Cloudflare Pages deployment via GitHub Action
- [ ] First commit, first deploy, first Plausible page view

**TDD seeds in `packages/core`:**

- [ ] Test: empty PDF parser returns empty array
- [ ] Test: empty rules engine returns "Uncategorized"
- [ ] Test: settlement on empty data returns zero per person

## Week 2 — PDF ingestion (15-20 hrs)

**Vertical slice:** Drop a PDF, see parsed txns in a table.

**TDD-first:**

- [ ] Port HDFC savings parser (test cases: 1 month sample → expected txn count + sum reconciliation)
- [ ] Port HDFC CC v1.6 parser (test: ₹3.17L Apple txn parses correctly)
- [ ] Port HDFC CC v1.3 parser (test: rewards point + Cr suffix handled)
- [ ] PDF.js + pdf-parse Web Worker scaffold
- [ ] PGlite + Drizzle init, run migrations
- [ ] Drag-and-drop UI in onboarding flow
- [ ] First-run flow: passphrase set, encrypted DB created
- [ ] Imported txns visible in a basic table

**Acceptance:** drop your existing 23 PDFs → all 1,807 txns appear, balance reconciles, no missing rows.

## Week 3 — Categorization engine (15-20 hrs)

**Vertical slice:** Txns auto-categorize on import; user can re-tag.

**TDD-first:**

- [ ] Port `rules.yaml` to `rules.ts` (type-safe, ordered, regex-based)
- [ ] Test: each rule matches expected sample narrations
- [ ] Test: 100+ samples produce expected categories
- [ ] Smart-suggest engine (counterparty → category map)
- [ ] Apply-to-similar logic
- [ ] Editable category dropdown in table

**Acceptance:** 70%+ of txns auto-categorized, edits persist, smart-suggest panel works.

## Week 4 — Charts + table (20-25 hrs)

**Vertical slice:** Click sunburst → table filters; edit → sunburst refreshes.

- [ ] ECharts sunburst component with click events
- [ ] Smooth zoom-in animation on slice click
- [ ] TanStack Table v8 with cell range selection
- [ ] Excel-style status bar (sum of selected cells)
- [ ] Sort + filter + virtual scroll
- [ ] Calendar heatmap (Visx)
- [ ] Polar weekday chart
- [ ] Color palette consistent across all charts (GROUP_COLORS)
- [ ] Storybook visual snapshots for each component

**Acceptance:** dashboard feels like Linear/Notion, not Streamlit.

## Week 5 — Review & Split (15-20 hrs)

**Vertical slice:** Mark Personal vs Shared → Settlement updates.

- [ ] People management UI (add Rahul, Shivam, etc. with UPI patterns)
- [ ] Split column with presets in transactions table
- [ ] Settlement engine: per-person owed, with auto-detected repayments
- [ ] Per-person breakdown in Review tab
- [ ] Donut: Personal vs Shared (my share) vs Front-paid

**Acceptance:** mark Bethprasad as 3-way split → see ₹6K appear as owed by Rahul + Shivam.

## Week 6 — Polish (15-20 hrs)

**Goal:** ship-quality UX. The "wow" pass.

- [ ] Framer Motion transitions on tab switches, slice clicks, table updates
- [ ] Empty states, loading skeletons, error boundaries
- [ ] Keyboard shortcuts: ⌘K command palette, j/k navigate months
- [ ] Dark/light theme toggle
- [ ] Responsive layout (graceful 768px+; below 768px shows "use a larger screen for v1")
- [ ] Onboarding: welcome → passphrase → drop PDF → first chart appears (3 steps, < 90 seconds)
- [ ] Settings: export DB, change passphrase, delete all data
- [ ] Help: tooltips on every chart, keyboard shortcut overlay

## Week 7 — Marketing site + content (10-15 hrs)

- [ ] Polish landing page with real screenshots
- [ ] /pricing page (Free vs future Sync tier)
- [ ] /privacy page (technical detail of local-first architecture)
- [ ] /how-it-works page (animated flow: PDF → parse → categorize → dashboard)
- [ ] Blog post 1: "Why I built SplitLens"
- [ ] Blog post 2: "Why bank aggregators are a privacy disaster"
- [ ] Blog post 3: "The math of shared expenses (or, why Splitwise gets it almost right)"
- [ ] 90-second demo video (Loom screen recording, no narration)
- [ ] Privacy Policy + ToS (Termly templates, India-jurisdiction)

## Week 8 — Beta with circle (10-15 hrs)

- [ ] Invite 10-15 people from your network (HDFC users) via DM
- [ ] Private Discord for beta feedback
- [ ] Fix top 5 reported issues
- [ ] Add to-be-added bank parsers based on feedback (likely ICICI #1)
- [ ] Iterate landing page copy based on what beta users say it does

## Week 9 — Public launch (full week)

**Tuesday (best day for ProductHunt):**

- [ ] Submit to ProductHunt 12:01 AM PST
- [ ] Day-of: respond to every comment within 30 min
- [ ] Cross-post to: r/IndianPersonalFinance, r/IndiaInvestments, r/india, r/developersIndia, r/programming, HN Show
- [ ] Twitter thread: 8-tweet build-in-public summary
- [ ] DM relevant Indian fintech journalists (Inc42, YourStory, The Ken)
- [ ] LinkedIn post (lower priority, India audience there)

**Rest of week:**

- [ ] Triage incoming feedback
- [ ] Hot-fix critical bugs only
- [ ] Update landing page based on what visitors say in chat / DMs

## Week 10 — Iterate on signal (15-20 hrs)

- [ ] Top 5 user-requested features → ship one per week starting now
- [ ] Begin weekly content cadence (1 blog post + 3 tweets per week)
- [ ] Plan v1.1: ICICI parser, AI narrative reports, recurring detector

---

## Risks + mitigations

| Risk                                     | Mitigation                                                                     |
| ---------------------------------------- | ------------------------------------------------------------------------------ |
| HDFC changes PDF format → parser breaks  | "Report a bad parse" button → users send redacted PDFs to a private repo issue |
| Beta users find a critical bug           | Hold launch — slip Week 9 by a week if needed. Don't launch broken.            |
| ProductHunt flop (likely)                | Plan a relaunch in Month 4 with mobile + Sync feature                          |
| Over-build features instead of marketing | Discipline: post-launch, half of every week is content/marketing               |
| Burnout at Week 5                        | Phase 1 is 9 weeks. Take Week 4 weekend off. Don't compress.                   |
| User asks for X bank → you spread thin   | Public roadmap: "ICICI in v1.1, vote here". Don't reactively build.            |

## Definition of Done for MVP

A user can:

1. Visit splitlens.app on a desktop browser
2. Click "Try it now" → set a passphrase
3. Drop a year of HDFC PDFs (savings + CC)
4. See their transactions categorized within 60 seconds
5. Click any sunburst slice → see filtered transactions
6. Mark a transaction as shared with Rahul → see it in Settlement
7. Export their entire DB as a downloadable file
8. Close the tab → reopen days later → all data is still there
9. Optionally: install as PWA on Chrome/Edge

If all 9 work without bugs → ship.
