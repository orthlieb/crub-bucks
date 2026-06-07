import { test, expect } from '@playwright/test';

/**
 * Public-page smoke tests. These need the app running and a reachable DB, but
 * no seeded data or authentication.
 */

test('landing page renders the hero and auth links', async ({ page }) => {
	await page.goto('/');
	await expect(page.locator('h1')).toContainText('Crub Bucks');
	await expect(page.getByRole('link', { name: 'Log in' }).first()).toBeVisible();
	await expect(page.getByRole('link', { name: 'Sign up' }).first()).toBeVisible();
});

test('login page shows the credentials form', async ({ page }) => {
	await page.goto('/login');
	await expect(page.locator('#email')).toBeVisible();
	await expect(page.locator('#password')).toBeVisible();
	await expect(page.getByRole('button', { name: 'Log in' })).toBeVisible();
});

test('register page is reachable from the landing page', async ({ page }) => {
	await page.goto('/');
	await page.getByRole('link', { name: 'Sign up' }).first().click();
	await expect(page).toHaveURL(/\/register/);
	await expect(page.locator('#email')).toBeVisible();
});

test('an unauthenticated visitor hitting /app is redirected to login', async ({ page }) => {
	await page.goto('/app');
	await expect(page).toHaveURL(/\/login/);
});
