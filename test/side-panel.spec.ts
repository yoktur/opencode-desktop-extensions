import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/test/fixture.html");
  await expect(page.getByRole("tab", { name: "Inspector", exact: true })).toBeVisible();
});

test("switches native browser, files, and extensions without losing drafts", async ({ page }) => {
  await page.getByRole("tab", { name: "Browser", exact: true }).click();
  await page.getByRole("tab", { name: "Inspector", exact: true }).click();
  await expect(page.getByRole("tabpanel", { name: "Browser", exact: true })).not.toBeVisible();
  await page.getByRole("textbox", { name: "Inspector input" }).fill("Retain this draft");
  await page.getByRole("tab", { name: "File", exact: true }).click();
  await expect(page.getByText("File content", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "Test results", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Test results input" })).toBeVisible();
  await page.getByRole("tab", { name: "Inspector", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Inspector input" })).toHaveValue("Retain this draft");
  await expect(page.locator('[role="tab"][aria-selected="true"]')).toHaveCount(1);
  await page.getByRole("button", { name: "Programmatic browser" }).click();
  await expect(page.getByText("Browser content", { exact: true })).toBeVisible();
  await expect(page.locator("body")).toHaveAttribute("data-active-Inspector", "false");
});

test("reveals collapsed panel, clears active on session change, and cleans up", async ({ page }) => {
  await page.getByRole("button", { name: "Toggle panel", exact: true }).click();
  await page.getByRole("button", { name: "Show Inspector", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Inspector input" })).toBeVisible();
  await page.getByRole("button", { name: "Change session" }).click();
  await expect(page.getByRole("textbox", { name: "Inspector input" })).not.toBeVisible();
  await page.getByRole("tab", { name: "Inspector", exact: true }).click();
  await page.getByRole("button", { name: "Disable Inspector", exact: true }).click();
  await expect(page.getByRole("tab", { name: "Inspector", exact: true })).toHaveCount(0);
  await expect(page.locator("body")).toHaveAttribute("data-aborted", "Inspector");
  await expect(page.getByText("Review content", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "Test results", exact: true }).click();
  await page.getByRole("tab", { name: "Test results", exact: true }).press("Home");
  await expect(page.getByRole("tab", { name: "Review", exact: true })).toBeFocused();
});

for (const dir of ["ltr", "rtl"]) test(`keyboard follows ${dir} tab order`, async ({ page }) => {
  await page.locator("html").evaluate((el, dir) => el.dir = dir, dir);
  await page.getByRole("tab", { name: "Inspector", exact: true }).click();
  await page.getByRole("tab", { name: "Inspector", exact: true }).press(dir === "rtl" ? "ArrowLeft" : "ArrowRight");
  await expect(page.getByRole("tab", { name: "Test results", exact: true })).toBeFocused();
  await expect(page.getByRole("textbox", { name: "Test results input" })).toBeVisible();
});
