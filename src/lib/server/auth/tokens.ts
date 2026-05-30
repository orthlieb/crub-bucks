import { and, eq, isNull, gt } from 'drizzle-orm';
import { randomBytes, createHash } from 'node:crypto';
import { db } from '../db';
import { authTokens } from '../db/schema';

/**
 * Single-use, time-limited tokens for email verification and password reset.
 *
 * The *raw* token is only ever transmitted by email; the database stores its
 * SHA-256 hash. Lookup is by hash, so leaking the auth_tokens table doesn't
 * expose usable tokens.
 *
 * Tokens are one-time: `usedAt` is set on first successful redeem. Subsequent
 * redeem attempts with the same token are rejected.
 */

export type TokenPurpose = 'verify_email' | 'reset_password';

const TOKEN_BYTES = 32; // 256 bits → 43-char base64url

function generateRawToken(): string {
	return randomBytes(TOKEN_BYTES).toString('base64url');
}

function hashToken(raw: string): string {
	return createHash('sha256').update(raw).digest('hex');
}

/**
 * Issue a new auth token. Returns the *raw* token (to email to the user);
 * the DB row holds the hash and expiry.
 */
export async function issueAuthToken(opts: {
	userId: string;
	purpose: TokenPurpose;
	expiresInMs: number;
}): Promise<string> {
	const raw = generateRawToken();
	const tokenHash = hashToken(raw);
	const expiresAt = new Date(Date.now() + opts.expiresInMs);
	await db.insert(authTokens).values({
		userId: opts.userId,
		purpose: opts.purpose,
		tokenHash,
		expiresAt
	});
	return raw;
}

/**
 * Look up an unused, unexpired token of the given purpose. Returns the row
 * (with userId) or null. Does NOT mark the token used — the caller must call
 * markTokenUsed() once any side-effects (e.g. password update, email-verify
 * flag) have committed.
 */
export async function findValidToken(opts: {
	rawToken: string;
	purpose: TokenPurpose;
}): Promise<{ id: string; userId: string } | null> {
	const tokenHash = hashToken(opts.rawToken);
	const [row] = await db
		.select({
			id: authTokens.id,
			userId: authTokens.userId
		})
		.from(authTokens)
		.where(
			and(
				eq(authTokens.tokenHash, tokenHash),
				eq(authTokens.purpose, opts.purpose),
				isNull(authTokens.usedAt),
				gt(authTokens.expiresAt, new Date())
			)
		)
		.limit(1);
	return row ?? null;
}

export async function markTokenUsed(tokenId: string): Promise<void> {
	await db.update(authTokens).set({ usedAt: new Date() }).where(eq(authTokens.id, tokenId));
}

/**
 * Convenience: validate + immediately consume in one call. Best for flows
 * where the side-effect (e.g. set emailVerifiedAt) and the consume happen
 * in the same transaction; for those cases just call findValidToken inside
 * a tx and markTokenUsed in the same tx.
 */
export async function redeemToken(opts: {
	rawToken: string;
	purpose: TokenPurpose;
}): Promise<{ userId: string } | null> {
	const found = await findValidToken(opts);
	if (!found) return null;
	await markTokenUsed(found.id);
	return { userId: found.userId };
}

// Re-export expiry windows in milliseconds for use in the routes.
export const TOKEN_EXPIRY_MS = {
	verify_email: 60 * 60 * 1000, // 1 hour
	reset_password: 60 * 60 * 1000 // 1 hour
} as const;
