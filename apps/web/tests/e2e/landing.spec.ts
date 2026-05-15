import { test, expect } from "@playwright/test";

test.describe("Landing page", () => {
  test("hero renders with the privacy wedge", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: /Your bank statements/i })).toBeVisible();
    await expect(page.getByText(/Nothing leaves your browser/i)).toBeVisible();
    await expect(page.getByRole("link", { name: /Star on GitHub/i }).first()).toBeVisible();
  });

  test("primary CTA navigates to the /try page", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: /Try it now/i }).click();
    await expect(page).toHaveURL(/\/try/);
    await expect(page.getByRole("heading", { name: /Drop your statement/i })).toBeVisible();
  });

  test("each section is reachable", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: /Why local-first/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: /What you can do/i })).toBeVisible();
  });
});

test.describe("/try page", () => {
  test("renders the dropzone + password input + back link", async ({ page }) => {
    await page.goto("/try");
    await expect(page.getByRole("heading", { name: /Drop your statement/i })).toBeVisible();
    await expect(page.getByLabel(/Upload PDF/i)).toBeVisible();
    await expect(page.getByLabel(/PDF password/i)).toBeVisible();
    await expect(page.getByRole("link", { name: /Back to home/i })).toBeVisible();
  });

  test("rejects non-PDF files with an inline error", async ({ page }) => {
    await page.goto("/try");
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles({
      name: "not-a-pdf.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("hello"),
    });
    await expect(page.getByRole("alert").filter({ hasText: /Not a PDF/i })).toBeVisible();
  });
});
