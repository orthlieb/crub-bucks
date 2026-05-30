import type { InferSelectModel } from 'drizzle-orm';
import type { sessions } from '$lib/server/db/schema';

declare global {
	namespace App {
		interface Locals {
			user: {
				id: string;
				email: string;
				displayName: string;
				role: 'user' | 'admin';
				isActive: boolean;
				emailVerifiedAt: Date | null;
			} | null;
			session: InferSelectModel<typeof sessions> | null;
		}
	}
}

export {};
