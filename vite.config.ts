import { defineConfig } from 'vitest/config';
import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
	test: {
		expect: { requireAssertions: true },
		// Coverage is enforced as a RATCHET FLOOR, not an aspiration. The
		// thresholds below sit just under current coverage of the business-logic
		// modules so the number can only go up — a new untested code path in
		// `src/lib` fails CI. Scope is the testable logic: framework glue
		// (`src/routes`, hooks), Svelte components, browser-only modules (DOM
		// actions, audio, push/avatar clients, service worker), and the DB
		// schema/migrate/seed are excluded because node unit/db tests can't
		// exercise them — those are covered by the Playwright e2e suite instead.
		// Raise these numbers as coverage improves; never lower them.
		coverage: {
			provider: 'v8',
			reporter: ['text-summary', 'html'],
			include: ['src/lib/**/*.ts'],
			exclude: [
				'src/lib/**/*.{test,spec}.ts',
				'src/lib/**/*.d.ts',
				'src/lib/components/**',
				'src/lib/actions/**',
				'src/lib/server/db/**',
				'src/lib/*-client.ts',
				'src/lib/sound.ts'
			],
			thresholds: {
				statements: 55,
				branches: 55,
				functions: 50,
				lines: 58
			}
		},
		projects: [
			// Pure unit tests. No shared state — vitest can run files in
			// parallel for speed. These should never touch the DB.
			{
				extends: './vite.config.ts',
				test: {
					name: 'unit',
					environment: 'node',
					include: ['src/**/*.{test,spec}.{js,ts}'],
					exclude: ['src/**/*.svelte.{test,spec}.{js,ts}', 'src/**/*.db.{test,spec}.{js,ts}']
				}
			},
			// DB-backed tests. All currently live in src/lib/server/ledger.db.test.ts,
			// but the `*.db.{test,spec}.ts` glob makes future DB suites opt in by
			// filename alone. Files run SEQUENTIALLY (fileParallelism: false) and
			// in a single fork (singleFork: true) so two suites can never race
			// each other while truncating the shared test database via resetDb().
			// Within a file, vitest already runs tests sequentially, so
			// `beforeEach(resetDb)` is enough to make every test independently
			// idempotent — run any test in isolation, in any order, repeatedly,
			// and you'll get the same result.
			{
				extends: './vite.config.ts',
				test: {
					name: 'db',
					environment: 'node',
					include: ['src/**/*.db.{test,spec}.{js,ts}'],
					// fileParallelism: false → vitest runs DB files one at a time
					// instead of in parallel workers. That's the race we needed
					// to prevent: two suites calling resetDb() against the shared
					// test DB simultaneously. Within a file vitest already runs
					// tests sequentially, so beforeEach(resetDb) is enough to
					// make every test independently idempotent.
					fileParallelism: false
				}
			}
		]
	}
});
