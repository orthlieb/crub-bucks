import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { env } from '$env/dynamic/private';
import * as schema from './schema';

// Lazily create the connection so importing this module during build/prerender
// analysis doesn't require DATABASE_URL to be present. The pool is created on
// first actual use at runtime.
let _client: ReturnType<typeof postgres> | undefined;
let _db: ReturnType<typeof drizzle<typeof schema>> | undefined;

function init() {
	if (_db) return _db;
	if (!env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
	_client = postgres(env.DATABASE_URL);
	_db = drizzle(_client, { schema });
	return _db;
}

// Proxy that initializes the real drizzle instance on first property access.
export const db = new Proxy({} as ReturnType<typeof drizzle<typeof schema>>, {
	get(_target, prop) {
		const real = init();
		const value = (real as any)[prop];
		return typeof value === 'function' ? value.bind(real) : value;
	}
});

export { schema };
