/**
 * Password policy constants. Lives outside $lib/server/ so client-side
 * code (form copy, hint text) can reference them safely — the server-side
 * validator at $lib/server/auth/password.ts re-exports these.
 */

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MIN_DISTINCT = 5;
