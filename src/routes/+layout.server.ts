import { getSystemConfig } from '$lib/server/auth/system-config';
import type { LayoutServerLoad } from './$types';

/**
 * Pick the visitor's preferred locale from the Accept-Language header so
 * amounts are formatted in *their* locale during SSR (and the client agrees,
 * avoiding a hydration mismatch). Falls back to en-US.
 *
 * "en-US,en;q=0.9,fr;q=0.8" → "en-US"
 */
function parseLocale(header: string | null): string {
	if (!header) return 'en-US';
	const first = header.split(',')[0]?.split(';')[0]?.trim();
	if (!first) return 'en-US';
	try {
		// Validates the tag; throws on malformed input.
		return Intl.NumberFormat.supportedLocalesOf([first])[0] ?? first;
	} catch {
		return 'en-US';
	}
}

/**
 * Root layout load. Exposes `user` for auth-aware navs and `locale` for
 * locale-aware amount formatting on every page's `data`. Per-user banners are
 * handled by the /app layout via the notifications system.
 */
export const load: LayoutServerLoad = async ({ locals, request }) => {
	// Asset-cache version (cheap singleton read) — appended to static image URLs
	// so an admin can force every client to refetch updated icons.
	const assetVersion = await getSystemConfig()
		.then((c) => c.assetVersion)
		.catch(() => 1);
	return {
		user: locals.user,
		locale: parseLocale(request.headers.get('accept-language')),
		assetVersion
	};
};
