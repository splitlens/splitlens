# Product Requirements — SplitLens MVP (v1.0)

## 1. Vision

SplitLens is the **most trusted personal finance tool in India** for people who want to actually understand where their money goes — not by surrendering bank credentials to an aggregator, but by parsing the statements they already have, **on their own device**.

We win on **trust**, not features. Every other player in this space (Cred, Jupiter, Fi, INDmoney, Khatabook, Money View) operates a cloud backend that holds user financial data. SplitLens holds none of it.

## 2. Audience

**Primary persona — "The Discerning Engineer"**
- 28-40 years old, urban India (BLR / HYD / Mumbai / Delhi NCR)
- Income ₹15-50L/yr, often switching jobs / freelancing / consulting
- Tech-literate, privacy-conscious
- Already exports bank PDFs for tax filing
- Frustrated by Mint-killing-itself, distrustful of giving aggregators bank credentials
- Lives in r/IndianPersonalFinance, r/IndiaInvestments, FinTech Twitter

**Secondary persona — "The Shared-Living Professional"**
- 25-32, lives in a flatshare in BLR / HYD
- Pays rent through a flatmate, splits utilities, cook, groceries
- Currently uses Splitwise + a spreadsheet — wants them unified
- ₹10-25L/yr income, ₹15-25K/mo shared bills

**Anti-persona (NOT for v1):**
- Casual users who want a budgeting app (use YNAB/Walnut)
- Investors looking for portfolio tracking (use INDmoney/Kuvera)
- Business owners (use Khatabook/Vyapar)

## 3. Problem statement

> "I have 12 months of HDFC statements as PDFs. I want to see where my money went, find recurring subscriptions I forgot about, and figure out who owes me what for shared bills — but I'm not handing over my net banking creds to some app, and Excel is too tedious."

## 4. Solution

A web app (later: native mobile + desktop) that:

1. **Parses** your bank PDFs (HDFC savings + CC at v1; ICICI/Axis/SBI at v2)
2. **Categorizes** every transaction using a learned rules engine
3. **Visualizes** spending patterns through interactive sunburst + monthly reports
4. **Tracks** shared expenses with named people (flatmates, family, partner)
5. **Computes** net settlements (who owes whom, how much)
6. **Stores** everything in PGlite (Postgres in browser, persisted to OPFS)

Critical: **no servers process user data**. Static HTML/JS hosted on Cloudflare Pages. Optional Sentry for crash reports (no PII).

## 5. MVP feature scope (Phase 1, ship by Week 9)

### Must have

- [ ] **Drag-and-drop PDF upload** — supports HDFC savings + HDFC credit card (v1.3 + v1.6 formats)
- [ ] **Encrypted local storage** — PGlite database in OPFS, optional passphrase encryption
- [ ] **Auto-categorization** — 100+ rules covering 70%+ of typical txns out of the box
- [ ] **Smart-suggest** — learns from user edits (counterparty → category map)
- [ ] **Apply-to-similar** — bulk re-tag from one edit
- [ ] **Interactive sunburst** — click to filter, smooth zoom animations
- [ ] **Excel-grade transaction table** — cell range selection with sum, sortable, editable categories inline
- [ ] **Monthly Report** — exec summary, KPIs, MoM deltas, anomalies, calendar heatmap, top counterparties
- [ ] **Shared expense tracking** — mark Personal vs Shared with N people
- [ ] **Settlement calculator** — net balance per person, with auto-detected repayments
- [ ] **Export everything** — JSON + CSV + DB file download (data portability is a feature)

### Nice to have (v1.1, post-launch)

- [ ] LLM-powered narrative monthly report (BYO API key)
- [ ] Recurring subscription detector (Subscription Audit)
- [ ] Vice tracker (cigarettes, takeout, etc. — generic "personal habits" tags)

### Explicitly OUT of scope (the discipline list)

- ❌ User accounts / auth (passphrase-only)
- ❌ Cloud sync (v2: BYOC — bring your own iCloud/Drive)
- ❌ Mobile native apps (Phase 2)
- ❌ Investment portfolio tracking
- ❌ Budgeting envelopes (compete with YNAB later)
- ❌ Multi-bank beyond HDFC (add ICICI/Axis/SBI in v1.1 based on requests)
- ❌ Multi-currency (INR only)
- ❌ Multi-language (English only)
- ❌ Email notifications
- ❌ Social features
- ❌ Custom rules editor in UI (export/edit JSON)

## 6. Success metrics

### Launch week (Week 9)
- 500 unique sessions (Plausible)
- 100 PDFs uploaded
- 50 GitHub stars on the OSS core
- Top 5 on ProductHunt for launch day

### Month 1 post-launch
- 2,000 unique sessions
- 1,000 active users (returned at least once)
- 30% week-2 retention
- 1,500 GitHub stars
- Featured in r/IndianPersonalFinance weekly thread

### Month 3 post-launch
- 10,000 cumulative users
- Native iOS + Android in TestFlight / Play Console internal
- BYOC sync in beta
- First press mention (Inc42 / YourStory / The Ken)

### Month 6 (paid tier launch)
- 200 paying users at ₹999/yr (₹2L MRR equivalent)
- 25,000 cumulative users
- 3,000 GitHub stars
- Sustainable solo project ✅

## 7. Open product decisions (need answers)

| # | Decision | My default | Status |
|---|---|---|---|
| 1 | Name | **SplitLens** (—) | Defaulted, awaiting confirmation |
| 2 | Sync strategy | Single-device v1, BYOC v2 | Defaulted |
| 3 | Open source | AGPL-3.0 for core, proprietary UI | Defaulted |
| 4 | Pricing | Free v1, paid sync v2 (₹999/yr) | Defaulted |
| 5 | Geography | India-only at launch (text + INR) | Defaulted |

## 8. Brand voice

- **Direct, no fluff.** ("Stop paying Cred to look at your statements.")
- **Privacy-first phrasing.** ("Your bank data never leaves this tab.")
- **Vernacular comfort.** Use Hindi + English code-switching where natural ("Apna splitlens, apne saath").
- **Anti-finfluencer tone.** Honest, dry, occasionally funny. Not "wealth coach" energy.
