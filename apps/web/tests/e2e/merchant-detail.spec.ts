import { test, expect } from "@playwright/test";

/**
 * Smoke coverage for the /merchants/[id] route.
 *
 * The merchant detail page needs real DB rows to render in full (KPIs,
 * 12-month chart, ledger), and the e2e suite intentionally doesn't seed
 * the canonical SQLite — that's the user's data. So these tests focus on
 * the framework-level guarantees that are stable regardless of DB state:
 *
 *   1. An unknown merchant id resolves to Next's 404 page.
 *   2. The global TopNav is suppressed on merchant routes (the page ships
 *      its own dark chrome).
 *   3. /merchants/[id] is in the compiled route table (implicit — Next
 *      returns 404 with the not-found body for unknown ids; a missing
 *      route would 404 with a *different* shape).
 *
 * If/when we seed a test DB, swap the second block for a real render check.
 */
test.describe("/merchants/[id]", () => {
  test("unknown id renders the 404 page", async ({ page }) => {
    const resp = await page.goto("/merchants/__does-not-exist-9f7a__");
    expect(resp?.status()).toBe(404);
    await expect(page.getByText(/could not be found/i)).toBeVisible();
  });

  test("global TopNav is suppressed on the merchant route", async ({ page }) => {
    // The dashboard renders TopNav; the merchant route should not.
    await page.goto("/dashboard");
    const navOnDashboard = await page.getByRole("navigation").count();
    expect(navOnDashboard).toBeGreaterThan(0);

    await page.goto("/merchants/__does-not-exist-9f7a__");
    // 404 page also doesn't render TopNav (suppressed by prefix); confirm
    // that the SplitLens brand link from TopNav is absent.
    await expect(
      page.getByRole("link", { name: /^SplitLens$/ }),
    ).toHaveCount(0);
  });
});
