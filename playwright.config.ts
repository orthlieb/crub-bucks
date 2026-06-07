import { defineConfig, devices } from '@playwright/test';

/**
 * Crub Bucks — Playwright end-to-end tests.
 *
 * Specs live in `e2e/` (kept out of `src/` so Vitest never picks them up).
 * Playwright starts its own dev server via the `webServer` block below; that
 * server inherits the environment, so point it at a SEEDED `*_test` database:
 *
 *   DATABASE_URL="postgres://crub:crub@localhost:5432/crubbucks_test" \
 *     npm run db:migrate && npm run db:seed
 *   DATABASE_URL="postgres://crub:crub@localhost:5432/crubbucks_test" \
 *     npm run test:e2e
 *
 * With no hCaptcha keys set, captcha verification short-circuits to "ok", so
 * the auth flows are exercisable without a captcha provider.
 */
export default defineConfig({
	testDir: './e2e',
	fullyParallel: false,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 2 : 0,
	workers: 1,
	reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',

	use: {
		baseURL: 'http://localhost:5173',
		trace: 'on-first-retry',
		screenshot: 'only-on-failure'
	},

	projects: [
		{
			name: 'chromium',
			use: { ...devices['Desktop Chrome'] }
		}
	],

	webServer: {
		command: 'npm run dev -- --port 5173',
		port: 5173,
		reuseExistingServer: !process.env.CI,
		timeout: 120_000
	}
});
