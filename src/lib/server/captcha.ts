import { env } from '$env/dynamic/private';

/**
 * Server-side hCaptcha verification.
 *
 * Behaviour:
 *   - If HCAPTCHA_SECRET is unset, verification is a no-op that returns
 *     { ok: true, skipped: true }. This keeps local dev frictionless;
 *     production must set the secret.
 *   - Otherwise we POST to hcaptcha.com/siteverify with the token from the
 *     client form, optionally passing the requester IP for risk scoring.
 *
 * The client-side widget is rendered via the public PUBLIC_HCAPTCHA_SITE_KEY
 * env var; a Captcha.svelte helper lives in $lib/components.
 */

const HCAPTCHA_VERIFY_URL = 'https://hcaptcha.com/siteverify';

export interface CaptchaResult {
	ok: boolean;
	/** true when HCAPTCHA_SECRET was unset and we short-circuited. */
	skipped: boolean;
	errorCodes?: string[];
}

export function isCaptchaConfigured(): boolean {
	return Boolean(env.HCAPTCHA_SECRET?.trim());
}

export async function verifyCaptcha(
	token: string | null | undefined,
	remoteIp?: string | null
): Promise<CaptchaResult> {
	const secret = env.HCAPTCHA_SECRET?.trim();
	if (!secret) return { ok: true, skipped: true };

	if (!token) return { ok: false, skipped: false, errorCodes: ['missing-input-response'] };

	const params = new URLSearchParams();
	params.set('secret', secret);
	params.set('response', token);
	if (remoteIp) params.set('remoteip', remoteIp);

	let res: Response;
	try {
		res = await fetch(HCAPTCHA_VERIFY_URL, {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: params.toString()
		});
	} catch (err) {
		console.warn('[captcha] verify request failed:', err);
		return { ok: false, skipped: false, errorCodes: ['network-error'] };
	}

	if (!res.ok) {
		return { ok: false, skipped: false, errorCodes: [`http-${res.status}`] };
	}

	const json = (await res.json().catch(() => ({}))) as {
		success?: boolean;
		'error-codes'?: string[];
	};

	if (json.success) return { ok: true, skipped: false };
	return { ok: false, skipped: false, errorCodes: json['error-codes'] ?? ['unknown'] };
}
