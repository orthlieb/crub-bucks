/**
 * Generates the favicon + home-screen/PWA icon set from a single vector mark.
 *
 * The brand mark is the colón sign (₡) — Crub Bucks' currency glyph — in white
 * on a violet field, matching the in-app brand badge and design tokens.
 *
 * Run with: npm i -D sharp && node scripts/generate-icons.mjs
 * (sharp is only needed to regenerate the assets; the output PNGs are committed,
 * so it is not a runtime/CI dependency.)
 *
 * Outputs to static/ :
 *   favicon.svg            crisp vector favicon (modern browsers)
 *   favicon-16.png         legacy favicon
 *   favicon-32.png         legacy favicon
 *   apple-touch-icon.png   180×180, full-bleed (iOS masks the corners itself)
 *   icon-192.png           PWA "any" icon
 *   icon-512.png           PWA "any" icon
 *   icon-maskable-512.png  PWA "maskable" icon (content kept inside the safe zone)
 */
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const STATIC = join(__dirname, '..', 'static');

// Violet brand colours (sRGB approximations of the oklch design tokens).
const VIOLET = '#7c3aed'; // ≈ violet-600/700, the primary
const VIOLET_DEEP = '#6d28d9'; // ≈ violet-700/800, gradient foot
const WHITE = '#ffffff';

/**
 * Build the mark as an SVG string.
 * @param {object} opts
 * @param {number} opts.size           pixel size of the square canvas
 * @param {'circle'|'rounded'|'square'} opts.shape  background silhouette
 * @param {number} [opts.pad]          fraction (0–0.5) of inset for the glyph,
 *                                     used to keep maskable icons in the safe zone
 */
function markSvg({ size, shape, pad = 0 }) {
	const s = size;
	const r = s * 0.22; // corner radius for the rounded square
	let bg;
	if (shape === 'circle') {
		bg = `<circle cx="${s / 2}" cy="${s / 2}" r="${s / 2}" fill="url(#g)"/>`;
	} else if (shape === 'rounded') {
		bg = `<rect width="${s}" height="${s}" rx="${r}" ry="${r}" fill="url(#g)"/>`;
	} else {
		bg = `<rect width="${s}" height="${s}" fill="url(#g)"/>`;
	}
	// Glyph metrics: scale the font down when extra padding is requested so the
	// colón stays comfortably inside the maskable safe zone (~80% of the canvas).
	const fontSize = s * (0.62 - pad * 1.2);
	// Optical baseline — sits the glyph slightly below centre.
	const baseline = s * 0.5 + fontSize * 0.35;
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${VIOLET}"/>
      <stop offset="1" stop-color="${VIOLET_DEEP}"/>
    </linearGradient>
  </defs>
  ${bg}
  <text x="${s / 2}" y="${baseline}" font-size="${fontSize}" text-anchor="middle"
        fill="${WHITE}" font-family="Helvetica, Arial, sans-serif" font-weight="700">₡</text>
</svg>`;
}

async function png(svg, size, outFile) {
	const out = join(STATIC, outFile);
	await sharp(Buffer.from(svg)).resize(size, size).png().toFile(out);
	console.log('wrote', outFile);
}

// --- favicon.svg (vector, circle to match the existing inline favicon) -------
const faviconSvg = markSvg({ size: 32, shape: 'circle' });
await sharp(Buffer.from(faviconSvg)); // validate it parses
import('node:fs').then(({ writeFileSync }) => {
	writeFileSync(join(STATIC, 'favicon.svg'), faviconSvg + '\n');
	console.log('wrote favicon.svg');
});

// --- raster favicons ---------------------------------------------------------
await png(markSvg({ size: 64, shape: 'circle' }), 16, 'favicon-16.png');
await png(markSvg({ size: 64, shape: 'circle' }), 32, 'favicon-32.png');

// --- iOS home-screen icon (full-bleed rounded square; iOS rounds it again) ---
await png(markSvg({ size: 360, shape: 'rounded' }), 180, 'apple-touch-icon.png');

// --- Android / PWA icons -----------------------------------------------------
await png(markSvg({ size: 512, shape: 'rounded' }), 192, 'icon-192.png');
await png(markSvg({ size: 512, shape: 'rounded' }), 512, 'icon-512.png');

// Maskable: full-bleed square background + padded glyph for the safe zone.
await png(markSvg({ size: 512, shape: 'square', pad: 0.12 }), 512, 'icon-maskable-512.png');
