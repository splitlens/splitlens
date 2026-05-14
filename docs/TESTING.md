# Testing Strategy — SplitLens

## TL;DR

| Layer               | Tool                              | Approach           | Why                                                              |
| ------------------- | --------------------------------- | ------------------ | ---------------------------------------------------------------- |
| `packages/core`     | **Vitest**                        | TDD, 90%+ coverage | Pure logic, deterministic, where bugs hurt most (financial math) |
| Database queries    | Vitest with PGlite in-memory      | Integration tests  | Verify Drizzle schema + queries produce expected shapes          |
| React components    | **Storybook** + visual regression | NOT TDD            | Tests for "does the button render" rot fast                      |
| Critical user paths | **Playwright**                    | E2E smoke tests    | High value, low maintenance, runs in CI                          |
| Performance         | Lighthouse CI on every PR         | Threshold gates    | Ship-quality is a CI assertion, not aspiration                   |

## Why TDD only `packages/core`

**TDD shines** when:

- Logic is pure (no I/O, no DOM, no time)
- Failure modes are predictable
- Refactors are common
- Bugs are expensive (off-by-one rupees → settlement is wrong → user trust shattered)

**TDD hurts** when:

- The tested surface is a UI component that changes weekly
- Tests assert implementation details (color codes, text labels)
- Setup is heavier than the assertion ("mount the component, fire 5 events, snapshot 200 lines")

So: TDD parsers, rules, settlement, encryption. Storybook + Playwright everything else.

## TDD workflow for parsers

Example for HDFC savings parser:

```typescript
// packages/core/tests/parsers/hdfc-savings.test.ts
import { describe, it, expect } from "vitest";
import { parseHdfcSavings } from "../../src/parsers/hdfc-savings";
import { readFileSync } from "fs";
import { join } from "path";

describe("HDFC Savings PDF parser", () => {
  it("returns empty array for empty input", async () => {
    expect(await parseHdfcSavings(new Uint8Array())).toEqual({ statement: null, transactions: [] });
  });

  it("extracts statement metadata", async () => {
    const pdf = readFileSync(join(__dirname, "fixtures/hdfc-savings-sample-1page.pdf"));
    const { statement } = await parseHdfcSavings(pdf, { password: "test" });
    expect(statement).toMatchObject({
      bank: "HDFC",
      accountLast4: "2491",
      periodFrom: "2025-04-01",
      periodTo: "2026-03-31",
    });
  });

  it("parses 5 known transactions correctly from page 1", async () => {
    const pdf = readFileSync(join(__dirname, "fixtures/hdfc-savings-sample-1page.pdf"));
    const { transactions } = await parseHdfcSavings(pdf, { password: "test" });
    expect(transactions).toHaveLength(5);
    expect(transactions[0]).toMatchObject({
      txnDate: "2025-04-01",
      narration: expect.stringContaining("UPI-MSREEPRAKASH"),
      withdrawal: 17.0,
      closingBalance: 466579.86,
    });
  });

  it("reconciles running balance across all rows", async () => {
    const pdf = readFileSync(join(__dirname, "fixtures/hdfc-savings-sample-full.pdf"));
    const { transactions } = await parseHdfcSavings(pdf, { password: "test" });
    let prev: number | null = null;
    for (const t of transactions) {
      if (prev !== null) {
        const expected = prev - (t.withdrawal ?? 0) + (t.deposit ?? 0);
        expect(Math.abs(t.closingBalance - expected)).toBeLessThan(0.01);
      }
      prev = t.closingBalance;
    }
  });

  it("handles encrypted PDF with wrong password", async () => {
    const pdf = readFileSync(join(__dirname, "fixtures/hdfc-savings-encrypted.pdf"));
    await expect(parseHdfcSavings(pdf, { password: "wrong" })).rejects.toThrow(/password/i);
  });

  it("strips footer noise from last txn on each page", async () => {
    const pdf = readFileSync(join(__dirname, "fixtures/hdfc-savings-multipage.pdf"));
    const { transactions } = await parseHdfcSavings(pdf, { password: "test" });
    for (const t of transactions) {
      expect(t.narration).not.toMatch(/HDFCBANKLIMITED|GSTN|RegisteredOffice/i);
    }
  });
});
```

## Test fixtures

`packages/core/tests/fixtures/` will hold **redacted, password-removed** sample PDFs:

- `hdfc-savings-sample-1page.pdf` (5 txns, known values)
- `hdfc-savings-sample-full.pdf` (full year, balance reconciliation)
- `hdfc-savings-encrypted.pdf` (password "test" for encryption tests)
- `hdfc-cc-v13-sample.pdf`
- `hdfc-cc-v16-sample.pdf`
- (and one fixture per quirk we discover)

These fixtures are checked into the repo (privacy-safe, redacted). They make the parser test suite **the most valuable asset** for community contributions later — anyone wanting to add ICICI/Axis/SBI parsers has a clear template to follow.

## Settlement engine TDD

```typescript
// packages/core/tests/settlement/calc.test.ts
describe("Settlement calculator", () => {
  it("zero balance for no shared txns", () => {
    expect(computeSettlement([], [])).toEqual({});
  });

  it("3-way split: ₹9000 paid by me with rahul + shivam → each owes ₹3000", () => {
    const txns = [
      { id: 1, amount: 9000, sharedWith: ["rahul", "shivam"], shareCount: 3, dir: "out" },
    ];
    const result = computeSettlement(txns, []);
    expect(result.rahul).toEqual({ owesMe: 3000, paidBack: 0, net: 3000 });
    expect(result.shivam).toEqual({ owesMe: 3000, paidBack: 0, net: 3000 });
  });

  it("subtracts repayments from inflows matching person's UPI patterns", () => {
    const txns = [{ id: 1, amount: 9000, sharedWith: ["rahul"], shareCount: 2, dir: "out" }];
    const inflows = [
      { id: 2, amount: 4500, narration: "UPI-RAHULKUMAR-9525680445@YBL-...", dir: "in" },
    ];
    const people = { rahul: { upiPatterns: ["9525680445"] } };
    const result = computeSettlement(txns, inflows, people);
    expect(result.rahul.net).toEqual(0); // paid back fully
  });
});
```

## Playwright E2E — the smoke tests that matter

Just 5 scenarios. They cover the whole product.

```typescript
// apps/web/tests/e2e/critical-paths.spec.ts

test("first-time user uploads PDF and sees dashboard", async ({ page }) => {
  await page.goto("/");
  await page.click('text="Try it now"');
  await page.fill('input[type="password"]', "testpassphrase123");
  await page.click('text="Continue"');
  await page.setInputFiles('input[type="file"]', "tests/fixtures/sample.pdf");
  await page.waitForSelector("text=/[0-9]+ transactions imported/");
  await expect(page.locator("canvas")).toBeVisible(); // sunburst
});

test("user clicks sunburst slice → table filters", async ({ page }) => {
  // ... seed DB, navigate, click slice, assert table rows
});

test("user marks shared expense → settlement updates", async ({ page }) => {
  // ... seed DB, change Split column, navigate to Settlement, assert balance
});

test("user reloads page → data persists", async ({ page, context }) => {
  // ... seed DB, reload, assert dashboard still shows data
});

test("user exports DB and re-imports it cleanly", async ({ page }) => {
  // ... seed, export, clear, import, assert
});
```

## Storybook visual regression

Every UI component gets a Storybook story. We use **Chromatic** (free tier 5,000 snapshots/mo) for visual regression on PRs. Catches:

- Unintended color changes
- Layout shifts
- Theme breakage

## CI pipeline

`.github/workflows/ci.yml`:

```yaml
on: [push, pull_request]
jobs:
  lint-type-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v3
      - uses: actions/setup-node@v4
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
      - run: pnpm typecheck
      - run: pnpm test # vitest, must pass
      - run: pnpm build # ensures static export works
  e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v3
      - run: pnpm install --frozen-lockfile
      - run: pnpm exec playwright install --with-deps
      - run: pnpm test:e2e
  visual:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: chromatic-com/action@v1
        with:
          projectToken: ${{ secrets.CHROMATIC_PROJECT_TOKEN }}
  lighthouse:
    runs-on: ubuntu-latest
    needs: lint-type-test
    steps:
      - uses: treosh/lighthouse-ci-action@v11
        with:
          urls: |
            https://splitlens-preview.pages.dev/
          budgetPath: ./.github/lighthouse-budget.json
```

Lighthouse budget enforces:

- Performance ≥ 90
- LCP < 2.5s
- TBT < 200ms
- CLS < 0.1

If any fail, PR is blocked. Quality is a precondition, not a hope.

## Testing what we'll NOT do

- ❌ Snapshot tests of React components (brittle, value-free)
- ❌ Tests that assert internal state of TanStack Query
- ❌ Tests of shadcn/ui primitives (already battle-tested upstream)
- ❌ Mocking Drizzle in unit tests (use real PGlite in-memory)
- ❌ Mocking PDF.js (use real fixtures)
- ❌ Coverage targets above 90% (diminishing returns)
