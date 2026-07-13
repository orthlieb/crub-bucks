import { RRule, rrulestr, type Options, type Weekday } from 'rrule';

/**
 * Task recurrence — a thin, chore-friendly wrapper over iCalendar RRULE (via the
 * `rrule` library). The picker's structured input is turned into a canonical
 * "DTSTART:…\nRRULE:…" string we store, plus a human label and the first due
 * date. Occurrences are day-granular (UTC midnight), which is plenty for chores.
 */

const WEEKDAYS: Record<string, Weekday> = {
	MO: RRule.MO,
	TU: RRule.TU,
	WE: RRule.WE,
	TH: RRule.TH,
	FR: RRule.FR,
	SA: RRule.SA,
	SU: RRule.SU
};

export type RecurrenceMode =
	| 'daily'
	| 'weekday'
	| 'weekly'
	| 'monthly_day'
	| 'monthly_nth'
	| 'yearly'
	| 'custom';

export interface RecurrenceInput {
	mode: RecurrenceMode;
	weekdays?: string[]; // MO..SU (weekly)
	monthday?: number; // 1..31 (monthly_day, yearly)
	nthPos?: number; // 1..4 or -1 for "last" (monthly_nth)
	nthWeekday?: string; // MO..SU (monthly_nth)
	month?: number; // 1..12 (yearly)
	interval?: number; // custom: every N
	customFreq?: 'day' | 'week' | 'month' | 'year'; // custom base
	endMode?: 'never' | 'count' | 'until'; // custom end
	count?: number;
	until?: string; // yyyy-mm-dd
}

export class RecurrenceError extends Error {}

export interface BuiltRecurrence {
	rrule: string;
	label: string;
	nextDueAt: Date | null;
}

/** Calendar date of `d` at UTC midnight (drops the time-of-day). */
function dayUTC(d: Date): Date {
	return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function capitalize(s: string): string {
	return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/** Build the stored rrule string + label + first due date from picker input. */
export function buildRecurrence(input: RecurrenceInput, from: Date): BuiltRecurrence {
	const dtstart = dayUTC(from);
	const opts: Partial<Options> = { dtstart };
	const FREQ = {
		day: RRule.DAILY,
		week: RRule.WEEKLY,
		month: RRule.MONTHLY,
		year: RRule.YEARLY
	} as const;

	switch (input.mode) {
		case 'daily':
			opts.freq = RRule.DAILY;
			break;
		case 'weekday':
			opts.freq = RRule.WEEKLY;
			opts.byweekday = [RRule.MO, RRule.TU, RRule.WE, RRule.TH, RRule.FR];
			break;
		case 'weekly': {
			const wds = (input.weekdays ?? []).map((w) => WEEKDAYS[w]).filter(Boolean);
			if (wds.length === 0) throw new RecurrenceError('Pick at least one weekday.');
			opts.freq = RRule.WEEKLY;
			opts.byweekday = wds;
			break;
		}
		case 'monthly_day': {
			const d = input.monthday ?? 0;
			if (!(d >= 1 && d <= 31)) throw new RecurrenceError('Pick a day of the month (1–31).');
			opts.freq = RRule.MONTHLY;
			opts.bymonthday = d;
			break;
		}
		case 'monthly_nth': {
			const wd = WEEKDAYS[input.nthWeekday ?? ''];
			const pos = input.nthPos ?? 0;
			if (!wd || ![1, 2, 3, 4, -1].includes(pos)) {
				throw new RecurrenceError('Pick which weekday and which week of the month.');
			}
			opts.freq = RRule.MONTHLY;
			opts.byweekday = [wd.nth(pos)];
			break;
		}
		case 'yearly': {
			const m = input.month ?? 0;
			const d = input.monthday ?? 0;
			if (!(m >= 1 && m <= 12) || !(d >= 1 && d <= 31)) {
				throw new RecurrenceError('Pick a month and day.');
			}
			opts.freq = RRule.YEARLY;
			opts.bymonth = m;
			opts.bymonthday = d;
			break;
		}
		case 'custom': {
			const n = input.interval ?? 1;
			if (!(Number.isInteger(n) && n >= 1))
				throw new RecurrenceError('Interval must be 1 or more.');
			opts.freq = FREQ[input.customFreq ?? 'week'];
			opts.interval = n;
			if (input.endMode === 'count') {
				const c = input.count ?? 0;
				if (!(Number.isInteger(c) && c >= 1)) {
					throw new RecurrenceError('End after 1 or more occurrences.');
				}
				opts.count = c;
			} else if (input.endMode === 'until' && input.until) {
				const u = new Date(`${input.until}T00:00:00Z`);
				if (Number.isNaN(u.getTime())) throw new RecurrenceError('Enter a valid end date.');
				opts.until = u;
			}
			break;
		}
		default:
			throw new RecurrenceError('Pick how the task repeats.');
	}

	const rule = new RRule(opts);
	// First occurrence on/after dtstart (inclusive).
	const first = rule.after(new Date(dtstart.getTime() - 1), true) ?? null;
	return { rrule: rule.toString(), label: capitalize(rule.toText()), nextDueAt: first };
}

/** Next occurrence strictly after `after`, or null if the recurrence is exhausted. */
export function nextOccurrenceAfter(rruleStr: string, after: Date): Date | null {
	try {
		return rrulestr(rruleStr).after(after, false) ?? null;
	} catch {
		return null;
	}
}

/** Human label for a stored rrule string ("Every week on Monday"). */
export function recurrenceLabel(rruleStr: string): string {
	try {
		const rule = rrulestr(rruleStr);
		return rule instanceof RRule ? capitalize(rule.toText()) : 'Recurring';
	} catch {
		return 'Recurring';
	}
}
