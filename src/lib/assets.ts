/**
 * Append the global asset-cache version to a static asset path so updated
 * images bypass stale browser / CDN caches. The version lives in system_config
 * (`assetVersion`) and is surfaced on every page's `data` via the root layout;
 * an admin bumps it from /admin/system to force clients to refetch.
 *
 *   assetUrl('/account.png', data.assetVersion) // → "/account.png?v=3"
 */
export function assetUrl(path: string, version: number): string {
	return `${path}?v=${version}`;
}
