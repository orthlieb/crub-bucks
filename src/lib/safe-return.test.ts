import { describe, it, expect } from 'vitest';
import { safeReturn } from './safe-return';

describe('safeReturn', () => {
	it('allows internal absolute paths', () => {
		expect(safeReturn('/add/abc')).toBe('/add/abc');
		expect(safeReturn('/app/friends?x=1')).toBe('/app/friends?x=1');
	});

	it('rejects absolute and protocol-relative URLs (open-redirect)', () => {
		expect(safeReturn('https://evil.com')).toBe('/app/friends');
		expect(safeReturn('//evil.com')).toBe('/app/friends');
		expect(safeReturn('javascript:alert(1)')).toBe('/app/friends');
		expect(safeReturn('app/friends')).toBe('/app/friends'); // not absolute
	});

	it('falls back on empty/null and honours a custom fallback', () => {
		expect(safeReturn('', '/app')).toBe('/app');
		expect(safeReturn(null)).toBe('/app/friends');
		expect(safeReturn(undefined, '/x')).toBe('/x');
		expect(safeReturn('//evil.com', '/app')).toBe('/app');
	});
});
