import { describe, it, expect } from 'vitest';
import { getFeed } from './index';

describe('getFeed', () => {
	it('defaults to the mock adapter (offline-safe) when SPORTS_FEED is unset', () => {
		// No SPORTS_FEED in the test env → mock keeps CI fully offline.
		expect(getFeed().provider).toBe('mock');
	});

	it('exposes the FeedAdapter contract', () => {
		const feed = getFeed();
		expect(typeof feed.listUpcoming).toBe('function');
		expect(typeof feed.getEvent).toBe('function');
	});
});
