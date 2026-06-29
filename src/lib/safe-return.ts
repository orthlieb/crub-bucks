/**
 * Sanitize a `returnTo` redirect target. Only internal, absolute-path URLs are
 * allowed; absolute URLs (`https://evil.com`) and protocol-relative ones
 * (`//evil.com`) are rejected to close the open-redirect hole. Falls back to a
 * safe default when the input is missing or unsafe.
 */
export function safeReturn(raw: string | null | undefined, fallback = '/app/friends'): string {
	if (raw && raw.startsWith('/') && !raw.startsWith('//')) return raw;
	return fallback;
}
