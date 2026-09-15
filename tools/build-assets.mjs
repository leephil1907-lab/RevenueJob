#!/usr/bin/env node
/**
 * build-assets.mjs — generates the brand assets and the SEO support files.
 *
 *   node tools/build-assets.mjs
 *
 * Everything here is vector design rendered deterministically from the brand
 * colours in site.config.json: no stock photography, no AI-generated imagery, no
 * third-party requests. Swap in your own artwork by replacing the files this
 * writes (paths are declared in site.config.json).
 *
 * Produces:
 *   assets/logo.svg, assets/logo-mark.svg
 *   assets/og-image.png                      (1200x630 social card)
 *   assets/icons/{favicon-16,32,48,icon-192,icon-512,maskable-512,apple-touch-icon}.png
 *   assets/icons/favicon.ico
 *   site.webmanifest, robots.txt, sitemap.xml, feed.xml
 *
 * Requires rsvg-convert (librsvg2-bin). ImageMagick `convert` is used for the .ico.
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { readFileSync } from 'node:fs';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const cfg = JSON.parse(readFileSync(`${ROOT}/site.config.json`, 'utf8'));
const locales = JSON.parse(readFileSync(`${ROOT}/i18n/locales.json`, 'utf8'));

/* The social card carries the real domain once there is one. While
   site.config.json still holds a placeholder, the card simply has no address
   line: a made-up domain printed on a shared image is worse than none. */
const url = cfg.site.url.replace(/\/$/, '');   // robots, sitemap and feed use the full address
const PLACEHOLDER_HOST = /example\.(com|org|net)|your-domain|placeholder/i.test(cfg.site.url);
const host = PLACEHOLDER_HOST ? '' : cfg.site.url.replace(/^https?:\/\//, '').replace(/\/$/, '');
const C = { primary: cfg.brand.primary, accent: cfg.brand.accent, surface: cfg.brand.surface };
const FONT = 'Liberation Sans, DejaVu Sans, Helvetica, Arial, sans-serif';

const have = (bin) => { try { execFileSync('which', [bin]); return true; } catch { return false; } };
const RSVG = have('rsvg-convert');
const CONVERT = have('convert');
if (!RSVG) { console.error('rsvg-convert is required: sudo apt-get install librsvg2-bin'); process.exit(1); }

mkdirSync(`${ROOT}/assets/icons`, { recursive: true });
const write = (p, s) => { writeFileSync(`${ROOT}/${p}`, s); console.log('  wrote ' + p); };
const TMP = `${ROOT}/.cache/assets`, tmpDir = mkdirSync(TMP, { recursive: true });
let tmpSeq = 0;
/* rsvg-convert here cannot read /dev/stdin, so render from a real temp file */
const render = (svg, out, w, h) => {
  const tmp = `${TMP}/render-${++tmpSeq}.svg`;
  writeFileSync(tmp, svg);
  execFileSync('rsvg-convert', ['-w', String(w), '-h', String(h), '-o', `${ROOT}/${out}`, tmp]);
  console.log(`  rendered ${out} (${w}x${h})`);
};

/* ── the mark: a containment hexagon around three converging chevrons and a core.
      It reads as "data moving inward to a decision", which is the product. ── */
const markDefs = (id) => `
    <linearGradient id="${id}-stroke" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${C.accent}"/>
      <stop offset="55%" stop-color="${C.primary}"/>
      <stop offset="100%" stop-color="#8a6bff"/>
    </linearGradient>
    <radialGradient id="${id}-glow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="${C.accent}" stop-opacity=".55"/>
      <stop offset="100%" stop-color="${C.accent}" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="${id}-word" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="60%" stop-color="#dbe7ff"/>
      <stop offset="100%" stop-color="${C.accent}"/>
    </linearGradient>`;

const markBody = (id, s = 512, pad = 0) => {
  const k = (s - pad * 2) / 512;
  return `<g transform="translate(${pad} ${pad}) scale(${k})">
    <circle cx="256" cy="256" r="248" fill="url(#${id}-glow)"/>
    <path d="M256 34 470 158v196L256 478 42 354V158Z" fill="${C.surface}" stroke="url(#${id}-stroke)" stroke-width="14" stroke-linejoin="round"/>
    <path d="M256 128 372 196v88L256 352 140 284v-88Z" fill="none" stroke="url(#${id}-stroke)" stroke-width="11" stroke-linejoin="round" opacity=".45"/>
    <path d="M186 226l60 34 60-34" fill="none" stroke="url(#${id}-stroke)" stroke-width="13" stroke-linecap="round" stroke-linejoin="round" opacity=".7"/>
    <path d="M206 262l40 23 40-23" fill="none" stroke="url(#${id}-stroke)" stroke-width="13" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="256" cy="292" r="26" fill="url(#${id}-stroke)"/>
    <circle cx="256" cy="292" r="42" fill="none" stroke="${C.accent}" stroke-width="5" opacity=".45"/>
  </g>`;
};

const mark = (size = 512, opts = {}) => {
  const id = opts.id || 'mk';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
  <defs>${markDefs(id)}</defs>
  ${markBody(id, size, opts.padding ?? 0)}
</svg>`;
};

/* ── the wordmark (mark + name + descriptor) ── */
const logo = (w = 760, h = 170) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
  <defs>${markDefs('lg')}</defs>
  <g transform="translate(6 22) scale(0.246)">${markBody('lg')}</g>
  <text x="158" y="92" font-family="${FONT}" font-size="56" font-weight="600" letter-spacing="0.5" fill="url(#lg-word)">Revenue<tspan font-weight="800">Pilot</tspan></text>
  <text x="160" y="126" font-family="${FONT}" font-size="19" letter-spacing="4.8" fill="#93a2c9">AI REVENUE AGENTS</text>
</svg>`;

/* ── social card: brand-accurate, real product words, no invented numbers ── */
const og = () => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630" width="1200" height="630">
  <defs>
    ${markDefs('og')}
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#05070f"/>
      <stop offset="55%" stop-color="#070c18"/>
      <stop offset="100%" stop-color="#0a0f22"/>
    </linearGradient>
    <radialGradient id="a" cx="16%" cy="12%" r="60%">
      <stop offset="0%" stop-color="${C.primary}" stop-opacity=".34"/>
      <stop offset="100%" stop-color="${C.primary}" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="b" cx="88%" cy="88%" r="58%">
      <stop offset="0%" stop-color="#8a6bff" stop-opacity=".30"/>
      <stop offset="100%" stop-color="#8a6bff" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <rect width="1200" height="630" fill="url(#a)"/>
  <rect width="1200" height="630" fill="url(#b)"/>

  <!-- the product's own pipeline model, drawn to scale: five stages into one core -->
  <g transform="translate(905 315)">
    ${[
      { r: 300, c: '#6fa8ff', o: .62, t: -10 },
      { r: 252, c: '#8a6bff', o: .56, t: -4 },
      { r: 204, c: '#5ae7ff', o: .50, t: 3 },
      { r: 156, c: '#46e3a4', o: .44, t: 9 },
      { r: 110, c: '#eafcff', o: .38, t: 15 }
    ].map(s => `<ellipse cx="0" cy="0" rx="${s.r}" ry="${s.r * 0.40}" fill="none" stroke="${s.c}" stroke-width="2.2" opacity="${s.o}" transform="rotate(${s.t})"/>`).join('\n    ')}
    ${[[300, -10], [-300, -10], [252, -4], [-252, -4], [204, 3], [-204, 3], [156, 9], [-156, 9], [110, 15], [-110, 15]].map(([x, rot], i) =>
      `<circle cx="${x * Math.cos(rot * Math.PI / 180)}" cy="${x * Math.sin(rot * Math.PI / 180) * 0.4}" r="4" fill="${['#6fa8ff', '#8a6bff', '#5ae7ff', '#46e3a4', '#eafcff'][Math.floor(i / 2)]}"/>`).join('\n    ')}
    <path d="M300 0 L120 46" stroke="#5ae7ff" stroke-width="1.6" opacity=".5"/>
    <path d="M-300 0 L-110 62" stroke="#46e3a4" stroke-width="1.6" opacity=".5"/>
    <circle cx="0" cy="0" r="62" fill="none" stroke="#8fb6ff" stroke-width="2" opacity=".65"/>
    <circle cx="0" cy="0" r="40" fill="#0a1024" stroke="#cfe4ff" stroke-width="1.6"/>
    <circle cx="0" cy="0" r="16" fill="url(#og-stroke)"/>
  </g>

  <!-- brand lockup -->
  <g transform="translate(84 84) scale(0.19)">${markBody('og')}</g>
  <text x="188" y="140" font-family="${FONT}" font-size="34" font-weight="600" fill="url(#og-word)">Revenue<tspan font-weight="800">Pilot</tspan></text>
  <text x="190" y="166" font-family="${FONT}" font-size="15" letter-spacing="3.6" fill="#7f8fb8">AI REVENUE AGENTS</text>

  <text x="84" y="330" font-family="${FONT}" font-size="68" font-weight="800" fill="url(#og-word)" letter-spacing="-1.6">Your AI revenue team.</text>
  <text x="84" y="410" font-family="${FONT}" font-size="68" font-weight="800" fill="url(#og-word)" letter-spacing="-1.6">Always working.</text>

  <text x="84" y="480" font-family="${FONT}" font-size="24" fill="#a9b8dd">Research · Outreach · Qualification · Meetings · Follow-up</text>
  <text x="84" y="516" font-family="${FONT}" font-size="24" fill="#a9b8dd">Human approval where it matters. Attribution you can audit.</text>

${host ? `  <text x="84" y="576" font-family="${FONT}" font-size="19" fill="#6d7ca4">${host}</text>` : ''}
  <rect x="0" y="0" width="1200" height="6" fill="url(#og-stroke)"/>
</svg>`;

/* ════════════════ 1. brand files ════════════════ */
console.log('brand assets');
write('assets/logo.svg', logo());
write('assets/logo-mark.svg', mark(512));

console.log('social card');
render(og(), 'assets/og-image.png', 1200, 630);

/* ════════════════ 2. icons ════════════════ */
console.log('icons');
const iconSizes = [
  ['assets/icons/favicon-16x16.png', 16],
  ['assets/icons/favicon-32x32.png', 32],
  ['assets/icons/favicon-48x48.png', 48],
  ['assets/icons/icon-192.png', 192],
  ['assets/icons/icon-512.png', 512],
  ['assets/icons/apple-touch-icon.png', 180]
];
iconSizes.forEach(([f, s]) => render(mark(s), f, s, s));
/* maskable: same art with the safe-zone padding Android requires */
render(mark(512, { padding: 78, id: 'mask' }), 'assets/icons/maskable-512.png', 512, 512);

if (CONVERT) {
  try {
    execFileSync('convert', [
      `${ROOT}/assets/icons/favicon-16x16.png`, `${ROOT}/assets/icons/favicon-32x32.png`,
      `${ROOT}/assets/icons/favicon-48x48.png`, `${ROOT}/assets/icons/favicon.ico`
    ]);
    console.log('  wrote assets/icons/favicon.ico (16/32/48 multi-size)');
  } catch (e) { console.log('  ! favicon.ico failed: ' + e.message.split('\n')[0]); }
}

/* ════════════════ 3. web manifest ════════════════ */
const manifest = {
  name: cfg.site.name,
  short_name: cfg.site.name,
  description: cfg.site.description,
  start_url: '/',
  scope: '/',
  display: 'standalone',
  background_color: C.surface,
  theme_color: cfg.site.themeColor,
  lang: cfg.site.defaultLocale,
  dir: locales.locales.find(l => l.code === cfg.site.defaultLocale).dir,
  categories: ['business', 'productivity', 'finance'],
  icons: [
    { src: 'assets/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: 'assets/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: 'assets/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
  ],
  shortcuts: [
    { name: 'Request access', url: '/#signup' },
    { name: 'Pricing', url: '/#pricing' },
    { name: 'Security', url: '/#trust' }
  ],
  screenshots: []
};
write('site.webmanifest', JSON.stringify(manifest, null, 2) + '\n');

/* ════════════════ 4. robots.txt ════════════════ */
const robots = `# ${cfg.site.name} — ${url}
# Generated by tools/build-assets.mjs. Edit site.config.json, not this file.

User-agent: *
Allow: /

# The admin console is a separate, authenticated service on its own origin.
# It must never be served from the public site, and it must not be indexed.
Disallow: /admin
Disallow: /admin/
Disallow: /app/
Disallow: /api/
Disallow: /*?utm_
Disallow: /*?ref=

# Be explicit with the crawlers that publish AI answers: the marketing pages
# are fine, the workspace and admin surfaces are not.
User-agent: GPTBot
Disallow: /admin
Disallow: /app/
Disallow: /api/
Allow: /

User-agent: CCBot
Disallow: /admin
Disallow: /app/

Sitemap: ${url}/sitemap.xml
`;
write('robots.txt', robots);

/* ════════════════ 5. sitemap.xml with hreflang alternates ════════════════ */
const today = new Date().toISOString().slice(0, 10);
const altLinks = cfg.site.locales.map(c => {
  const href = `${url}/${c === cfg.site.defaultLocale ? '' : c + '/'}`;
  return `    <xhtml:link rel="alternate" hreflang="${c}" href="${href}"/>`;
}).join('\n');
const urls = [
  { loc: `${url}/`, priority: '1.0', freq: 'weekly' },
  ...cfg.site.locales.filter(c => c !== cfg.site.defaultLocale)
    .map(c => ({ loc: `${url}/${c}/`, priority: '0.8', freq: 'weekly' }))
];
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml">
${urls.map(u => `  <url>
    <loc>${u.loc}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>${u.freq}</changefreq>
    <priority>${u.priority}</priority>
${altLinks}
  </url>`).join('\n')}
</urlset>
`;
write('sitemap.xml', sitemap);

/* ════════════════ 6. feed.xml (announcements / changelog) ════════════════ */
const feed = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${cfg.site.name} — product updates</title>
    <link>${url}/</link>
    <description>${cfg.site.description}</description>
    <language>${cfg.site.defaultLocale}</language>
    <atom:link href="${url}/feed.xml" rel="self" type="application/rss+xml"/>
    <!-- Add entries here (or via the admin console) as the product ships. -->
  </channel>
</rss>
`;
write('feed.xml', feed);

console.log('\nassets complete');
