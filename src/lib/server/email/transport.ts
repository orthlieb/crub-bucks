import { env } from '$env/dynamic/private';
import { env as publicEnv } from '$env/dynamic/public';

/**
 * Email transport abstraction. Two implementations:
 *   - ConsoleTransport — logs to stdout, used in dev when RESEND_API_KEY is unset
 *   - ResendTransport  — POSTs to the Resend HTTP API
 *
 * Selection is automatic: if RESEND_API_KEY is present, ResendTransport;
 * otherwise ConsoleTransport. Both honour EMAIL_FROM as the sender address.
 *
 * No SDK dependency — Resend is called with plain fetch.
 */

export interface EmailMessage {
	to: string;
	subject: string;
	html: string;
	text: string;
}

export interface EmailTransport {
	name: string;
	send(msg: EmailMessage): Promise<void>;
}

class ConsoleTransport implements EmailTransport {
	readonly name = 'console';
	async send(msg: EmailMessage): Promise<void> {
		const banner = '─'.repeat(72);
		console.log(
			[
				'',
				banner,
				`[email:console] from=${getFromAddress()}`,
				`[email:console]   to=${msg.to}`,
				`[email:console]   subject=${msg.subject}`,
				banner,
				msg.text,
				banner,
				''
			].join('\n')
		);
	}
}

class ResendTransport implements EmailTransport {
	readonly name = 'resend';
	constructor(private readonly apiKey: string) {}
	async send(msg: EmailMessage): Promise<void> {
		const res = await fetch('https://api.resend.com/emails', {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${this.apiKey}`,
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				from: getFromAddress(),
				to: msg.to,
				subject: msg.subject,
				html: msg.html,
				text: msg.text
			})
		});
		if (!res.ok) {
			const body = await res.text().catch(() => '');
			throw new Error(`Resend send failed: ${res.status} ${res.statusText} ${body}`);
		}
	}
}

let _transport: EmailTransport | undefined;

export function getEmailTransport(): EmailTransport {
	if (_transport) return _transport;
	const key = env.RESEND_API_KEY?.trim();
	_transport = key ? new ResendTransport(key) : new ConsoleTransport();
	return _transport;
}

/** Test hook — allow tests to swap in a fake transport. */
export function setEmailTransport(t: EmailTransport): void {
	_transport = t;
}

export function getFromAddress(): string {
	return env.EMAIL_FROM?.trim() || 'Crub Bucks <no-reply@crub-bucks.local>';
}

/** Base URL for absolute links in emails (e.g. verification/reset URLs). */
export function getAppUrl(): string {
	return (publicEnv.PUBLIC_APP_URL?.trim() || 'http://localhost:5173').replace(/\/$/, '');
}
