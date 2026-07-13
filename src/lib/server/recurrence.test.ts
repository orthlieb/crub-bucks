import { describe, it, expect } from 'vitest';
import {
	buildRecurrence,
	nextOccurrenceAfter,
	recurrenceLabel,
	RecurrenceError
} from './recurrence';

// A fixed anchor so occurrence math is deterministic. 2026-07-12 is a Sunday.
const FROM = new Date('2026-07-12T12:00:00Z');

/** UTC yyyy-mm-dd of a Date (occurrences are day-granular at UTC midnight). */
const ymd = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

describe('buildRecurrence', () => {
	it('daily starts today and repeats every day', () => {
		const r = buildRecurrence({ mode: 'daily' }, FROM);
		expect(r.rrule).toContain('FREQ=DAILY');
		expect(ymd(r.nextDueAt)).toBe('2026-07-12');
		expect(r.label.toLowerCase()).toContain('day');
		// Next after the first is the following day.
		expect(ymd(nextOccurrenceAfter(r.rrule, r.nextDueAt!))).toBe('2026-07-13');
	});

	it('every weekday skips the weekend', () => {
		const r = buildRecurrence({ mode: 'weekday' }, FROM); // Sunday
		expect(r.rrule).toContain('BYDAY=MO,TU,WE,TH,FR');
		expect(ymd(r.nextDueAt)).toBe('2026-07-13'); // Monday, not Sunday
	});

	it('weekly on chosen days picks the next matching day', () => {
		const r = buildRecurrence({ mode: 'weekly', weekdays: ['TU', 'TH'] }, FROM);
		expect(r.rrule).toContain('FREQ=WEEKLY');
		expect(ymd(r.nextDueAt)).toBe('2026-07-14'); // Tuesday
		expect(ymd(nextOccurrenceAfter(r.rrule, r.nextDueAt!))).toBe('2026-07-16'); // Thursday
	});

	it('weekly with no days chosen is rejected', () => {
		expect(() => buildRecurrence({ mode: 'weekly', weekdays: [] }, FROM)).toThrow(RecurrenceError);
	});

	it('monthly on a day lands on that day of the month', () => {
		const r = buildRecurrence({ mode: 'monthly_day', monthday: 20 }, FROM);
		expect(r.rrule).toContain('BYMONTHDAY=20');
		expect(ymd(r.nextDueAt)).toBe('2026-07-20');
	});

	it('monthly on the nth weekday resolves the right date', () => {
		// Third Monday on/after 2026-07-12 → 2026-07-20.
		const r = buildRecurrence({ mode: 'monthly_nth', nthPos: 3, nthWeekday: 'MO' }, FROM);
		expect(r.rrule).toContain('BYDAY=+3MO');
		expect(ymd(r.nextDueAt)).toBe('2026-07-20');
	});

	it('monthly on the last weekday uses -1', () => {
		const r = buildRecurrence({ mode: 'monthly_nth', nthPos: -1, nthWeekday: 'FR' }, FROM);
		expect(r.rrule).toContain('BYDAY=-1FR');
		expect(ymd(r.nextDueAt)).toBe('2026-07-31'); // last Friday of July 2026
	});

	it('yearly lands on the month + day, rolling to next year if past', () => {
		const r = buildRecurrence({ mode: 'yearly', month: 3, monthday: 15 }, FROM);
		expect(r.rrule).toContain('FREQ=YEARLY');
		expect(ymd(r.nextDueAt)).toBe('2027-03-15'); // March already passed in 2026
	});

	it('custom every N weeks respects the interval', () => {
		const r = buildRecurrence({ mode: 'custom', interval: 2, customFreq: 'week' }, FROM);
		expect(r.rrule).toContain('INTERVAL=2');
		expect(r.rrule).toContain('FREQ=WEEKLY');
		expect(ymd(r.nextDueAt)).toBe('2026-07-12');
		expect(ymd(nextOccurrenceAfter(r.rrule, r.nextDueAt!))).toBe('2026-07-26');
	});

	it('custom with a count end exhausts after N occurrences', () => {
		const r = buildRecurrence(
			{ mode: 'custom', interval: 1, customFreq: 'day', endMode: 'count', count: 2 },
			FROM
		);
		expect(r.rrule).toContain('COUNT=2');
		const second = nextOccurrenceAfter(r.rrule, r.nextDueAt!);
		expect(ymd(second)).toBe('2026-07-13');
		expect(nextOccurrenceAfter(r.rrule, second!)).toBeNull(); // only two total
	});

	it('custom with an until date stops after it', () => {
		const r = buildRecurrence(
			{ mode: 'custom', interval: 1, customFreq: 'day', endMode: 'until', until: '2026-07-14' },
			FROM
		);
		expect(r.rrule).toContain('UNTIL=');
		// 12th, 13th, 14th are in; the 15th is past the end.
		expect(nextOccurrenceAfter(r.rrule, new Date('2026-07-14T00:00:00Z'))).toBeNull();
	});

	it('rejects a bad custom interval', () => {
		expect(() => buildRecurrence({ mode: 'custom', interval: 0, customFreq: 'day' }, FROM)).toThrow(
			RecurrenceError
		);
	});

	it('rejects an out-of-range month day', () => {
		expect(() => buildRecurrence({ mode: 'monthly_day', monthday: 40 }, FROM)).toThrow(
			RecurrenceError
		);
	});
});

describe('nextOccurrenceAfter', () => {
	it('returns null on an unparseable rule', () => {
		expect(nextOccurrenceAfter('not a rule', FROM)).toBeNull();
	});
});

describe('recurrenceLabel', () => {
	it('produces human text from a stored rule', () => {
		const r = buildRecurrence({ mode: 'weekly', weekdays: ['MO'] }, FROM);
		expect(recurrenceLabel(r.rrule).toLowerCase()).toContain('week');
	});

	it('falls back to "Recurring" on a bad rule', () => {
		expect(recurrenceLabel('garbage')).toBe('Recurring');
	});
});
