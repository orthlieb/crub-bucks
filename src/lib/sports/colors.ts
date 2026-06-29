/**
 * Curated accent colors for the icon area of sports cards. Picked per league (a
 * brand-ish hue), with a per-sport fallback and a final default. These are only
 * ever used as a soft ~15% tint behind the league logo, so they need to be
 * distinct and pleasant rather than exact brand values. Deterministic — no image
 * processing, so it works for any logo regardless of CORS.
 */

const LEAGUE_COLOR: Record<string, string> = {
	MLB: '#0a2342', // navy
	NFL: '#013369',
	NBA: '#c9082a',
	WNBA: '#e35205',
	"Men's College Basketball": '#ea580c',
	NHL: '#3b4252',
	'FIFA World Cup': '#326295',
	'Premier League': '#37003c',
	'Champions League': '#1b1f4b',
	MLS: '#1b458f',
	'College Football': '#7c2d12',
	CFL: '#c8102e',
	ATP: '#0f766e', // teal
	WTA: '#7e22ce', // purple
	UFC: '#991b1b' // red
};

const SPORT_COLOR: Record<string, string> = {
	soccer: '#15803d',
	baseball: '#0a2342',
	basketball: '#ea580c',
	football: '#013369',
	cfl: '#c8102e',
	hockey: '#3b4252',
	tennis: '#0f766e',
	mma: '#991b1b'
};

/** Theme primary (violet) — last-resort accent for an unmapped sport/league. */
const DEFAULT_COLOR = '#7c3aed';

/** Accent color for a league within a sport (league wins, then sport, then default). */
export function leagueColor(league: string, sport: string): string {
	return LEAGUE_COLOR[league] ?? SPORT_COLOR[sport] ?? DEFAULT_COLOR;
}
