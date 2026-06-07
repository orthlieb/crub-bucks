import { describe, it, expect, beforeEach } from 'vitest';
import { sendReportEmail } from './index';
import { setEmailTransport, type EmailMessage, type EmailTransport } from './transport';

// Capture sent mail instead of hitting a real transport.
let sent: EmailMessage[];
beforeEach(() => {
	sent = [];
	const fake: EmailTransport = {
		name: 'test',
		async send(msg) {
			sent.push(msg);
		}
	};
	setEmailTransport(fake);
});

describe('sendReportEmail', () => {
	it('emails the reports address with the report details', async () => {
		await sendReportEmail({
			reporterName: 'Gerrit',
			reporterEmail: 'gerrit@example.com',
			reporterId: 'u-123',
			targetType: 'bet',
			targetId: 'b-456',
			targetLabel: 'A rude title',
			content: 'A rude title — and a rude note',
			reason: 'name-calling'
		});

		expect(sent).toHaveLength(1);
		const m = sent[0];
		// Default recipient when REPORTS_EMAIL is unset.
		expect(m.to).toBe('info@crubbucks.com');
		expect(m.subject).toContain('A rude title');
		// Plaintext body carries the actionable details.
		expect(m.text).toContain('Gerrit');
		expect(m.text).toContain('gerrit@example.com');
		expect(m.text).toContain('b-456');
		expect(m.text).toContain('name-calling');
		expect(m.text).toContain('A rude title — and a rude note');
		// HTML is escaped (no raw em-dash injection issues, tags balanced enough).
		expect(m.html).toContain('Gerrit');
	});

	it('notes when no reason was given', async () => {
		await sendReportEmail({
			reporterName: 'Dabbles',
			reporterEmail: 'dab@example.com',
			reporterId: 'u-1',
			targetType: 'user',
			targetId: 'u-2',
			targetLabel: 'BadName',
			reason: null
		});
		expect(sent[0].text).toContain('(none given)');
		expect(sent[0].subject).toContain('user');
	});
});
