import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	kit: {
		adapter: adapter(),
		version: {
			// Poll the deployed build's version.json so clients notice a new deploy
			// and can offer a refresh (see UpdatePrompt). Flips the `updated` store.
			pollInterval: 60_000
		}
	}
};

export default config;
