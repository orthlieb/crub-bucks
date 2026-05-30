import { defineConfig } from 'drizzle-kit';

if (!process.env.DATABASE_URL) {
	// Loaded from .env in dev; required in all environments.
	console.warn('DATABASE_URL is not set — drizzle-kit commands will fail until it is.');
}

export default defineConfig({
	schema: './src/lib/server/db/schema.ts',
	out: './drizzle',
	dialect: 'postgresql',
	dbCredentials: {
		url: process.env.DATABASE_URL!
	},
	verbose: true,
	strict: true
});
