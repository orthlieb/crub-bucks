import js from '@eslint/js';
import ts from 'typescript-eslint';
import svelte from 'eslint-plugin-svelte';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default ts.config(
	js.configs.recommended,
	...ts.configs.recommended,
	...svelte.configs.recommended,
	prettier,
	...svelte.configs.prettier,
	{
		languageOptions: {
			globals: { ...globals.browser, ...globals.node }
		},
		rules: {
			// Underscore-prefixed args/vars are intentional throwaways.
			'@typescript-eslint/no-unused-vars': [
				'error',
				{ argsIgnorePattern: '^_', varsIgnorePattern: '^_' }
			],
			// `any` is occasionally pragmatic (third-party shims); surface, don't block.
			'@typescript-eslint/no-explicit-any': 'warn',
			// Noisy and not bug-indicative for this codebase's branch-assign patterns.
			'no-useless-assignment': 'off',
			// The app intentionally uses plain hrefs (no base path), so resolve()
			// is unnecessary ceremony on every link.
			'svelte/no-navigation-without-resolve': 'off',
			// Judgment calls worth seeing but not worth failing CI over.
			'svelte/no-dom-manipulating': 'warn',
			'svelte/prefer-svelte-reactivity': 'warn'
		}
	},
	{
		files: ['**/*.svelte', '**/*.svelte.ts', '**/*.svelte.js'],
		languageOptions: {
			parserOptions: { parser: ts.parser }
		}
	},
	{
		// Generated, vendored, or non-source output — don't lint.
		ignores: [
			'.svelte-kit/',
			'build/',
			'package/',
			'coverage/',
			'playwright-report/',
			'test-results/',
			'drizzle/',
			'src/lib/components/ui/'
		]
	}
);
