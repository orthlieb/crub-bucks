import { defineConfig } from 'vitest/config';
import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
	test: {
		expect: { requireAssertions: true },
		projects: [
			// Pure unit tests. No shared state — vitest can run files in
			// parallel for speed. These should never touch the DB.
			{
				extends: './vite.config.ts',
				test: {
					name: 'unit',
					environment: 'node',
					include: ['src/**/*.{test,spec}.{js,ts}'],
					exclude: [
						'src/**/*.svelte.{test,spec}.{js,ts}',
						'src/**/*.db.{test,spec}.{js,ts}'
					]
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
					// fileParallelism: false → vitest runs DB files one at a time.
					// pool: 'forks' + singleFork: true → all tests in a single
					// fork, so module-level state (e.g. counter for unique
					// emails in createUser) is shared but no two processes
					// share the DB simultaneously.
					fileParallelism: false,
					pool: 'forks',
					singleFork: true
				}
			}
		]
	}
});
