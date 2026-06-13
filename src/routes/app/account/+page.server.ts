import { getAccountStatement } from '$lib/server/ledger';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const statement = await getAccountStatement(locals.user!.id);
	return { statement };
};
