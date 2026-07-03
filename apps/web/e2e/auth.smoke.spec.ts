import { expect, test } from "@playwright/test";

const loginEmail = process.env.VERFT_E2E_EMAIL ?? "admin@verft.local";
const loginPassword = process.env.VERFT_E2E_PASSWORD ?? "admin123!";

test("smoke: login route renders", async ({ page }) => {
  await page.goto("/login");

  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await expect(page.getByLabel("Email")).toBeVisible();
  await expect(page.getByLabel("Password")).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
});

test("smoke: main route redirects to login when signed out", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveURL(/\/login$/, { timeout: 20_000 });
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
});

test("happy path: seeded admin can sign in", async ({ page }) => {
  await page.goto("/login");

  await page.getByLabel("Email").fill(loginEmail);
  await page.getByLabel("Password").fill(loginPassword);
  await page.getByTestId("login-submit-button").click();

  await expect(page).toHaveURL(/\/(tasks|snippets|repositories|settings|users)(\/.*)?$/, { timeout: 20_000 });
  await expect(page.getByRole("button", { name: "Logout" })).toBeVisible();
});
