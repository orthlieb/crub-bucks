import { test, expect } from '@playwright/test';

/**
 * Authenticated flow. Requires the `*_test` database to be migrated AND seeded
 * (`npm run db:seed`), which creates the demo user below. With no hCaptcha keys
 * configured, the Captcha component hands the form an "unconfigured" sentinel
 * token so the submit button is enabled.
 */

const SEED_EMAIL = 'carl@example.com';
const SEED_PASSWORD = 'password123';

test('a seeded user can log in and reach the app', async ({ page }) => {
	await page.goto('/login');
	await page.locator('#email').fill(SEED_EMAIL);
	await page.locator('#password').fill(SEED_PASSWORD);
	await page.getByRole('button', { name: 'Log in' }).click();

	await expect(page).toHaveURL(/\/app/);
	// We're in the authenticated shell now — the login form is gone.
	await expect(page.locator('#password')).toHaveCount(0);
});

test('wrong password keeps the user on the login page with an error', async ({ page }) => {
	await page.goto('/login');
	await page.locator('#email').fill(SEED_EMAIL);
	await page.locator('#password').fill('definitely-the-wrong-password');
	await page.getByRole('button', { name: 'Log in' }).click();

	await expect(page).toHaveURL(/\/login/);
	await expect(page.getByText(/invalid email or password/i)).toBeVisible();
});
