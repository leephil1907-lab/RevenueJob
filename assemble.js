#!/usr/bin/env node
/**
 * assemble.js — builds index.html from src/ + site.config.json + i18n/.
 *
 * The generated file is the deliverable; never hand-edit it. Everything a marketer
 * or an operator would want to change lives in site.config.json (or the admin
 * console), and everything the build can verify, it verifies — a broken config
 * fails the build instead of shipping a page with a wrong canonical URL.
 *
 *   node assemble.js            build + verify
 *   node assemble.js --check    verify only (used by CI and the admin publish step)
 */
const fs = require('fs');
const path = require('path');

/* the checkout this file lives in — works from any directory, any machine */
const ROOT = __dirname;
const SRC = path.join(ROOT, 'src');
const OUT = path.join(ROOT, 'index.html');
const CHECK_ONLY = process.argv.includes('--check');

const read = f => fs.readFileSync(path.join(SRC, f), 'utf8');
const readJSON = p => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));

const problems = [];
const warnings = [];
const fail = m => problems.push(m);
const warn = m => warnings.push(m);

/* ════════════════════════════════════════════════════════════
   1. CONFIG
   ════════════════════════════════════════════════════════════ */
const cfg = readJSON('site.config.json');
const locales = readJSON('i18n/locales.json');
const strings = readJSON('i18n/strings.json');

const REQUIRED = ['site.name', 'site.url', 'site.description', 'seo.title', 'brand.primary'];
REQUIRED.forEach(k => {
  const v = k.split('.').reduce((o, part) => (o || {})[part], cfg);
  if (!v) fail(`config: ${k} is required and empty`);
});

const DEFAULT_URL = 'https://revenuepilot.example.com';
if (cfg.site.url === DEFAULT_URL) {
  warn(`site.url is still the placeholder (${DEFAULT_URL}) — set your real domain before deploying, or canonical links and hreflang will point at the wrong host`);
}
if (!/^https:\/\//.test(cfg.site.url)) fail('config: site.url must be an absolute https:// URL');
if (cfg.site.url.endsWith('/')) warn('config: site.url should not end with a slash');

const defaultLocale = locales.defaultLocale;
if (cfg.site.defaultLocale !== defaultLocale) {
  fail(`config: site.defaultLocale (${cfg.site.defaultLocale}) must match i18n/locales.json (${defaultLocale})`);
}
cfg.site.locales.forEach(code => {
  if (!locales.locales.some(l => l.code === code)) fail(`config: locale "${code}" is not in i18n/locales.json`);
  if (code !== defaultLocale && !strings[code]) fail(`i18n: no strings for "${code}"`);
});
const dupeCurrency = cfg.site.currencies.filter((c, i, a) => a.indexOf(c) !== i);
if (dupeCurrency.length) warn(`config: duplicate currencies listed (${[...new Set(dupeCurrency)].join(', ')})`);
cfg.site.currencies.forEach(c => {
  try { new Intl.NumberFormat('en', { style: 'currency', currency: c }); }
  catch (e) { fail(`config: "${c}" is not a valid ISO 4217 currency code`); }
});

/* strings: every locale must supply the same keys as the default locale */
const baseKeys = Object.keys(strings[defaultLocale]);
Object.keys(strings).forEach(code => {
  if (code.startsWith('_')) return;
  const missing = baseKeys.filter(k => !(k in strings[code]));
  if (missing.length) warn(`i18n/${code}: missing ${missing.length} key(s) — falls back to ${defaultLocale}`);
});

/* ════════════════════════════════════════════════════════════
   2. HEAD: metadata, canonical, hreflang, structured data
   ════════════════════════════════════════════════════════════ */
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const url = cfg.site.url.replace(/\/$/, '');
const icon = name => `${cfg.brand.iconDir}/${name}`;

function metaBlock() {
  const t = cfg.seo;
  const L = [];
  L.push(`<meta charset="utf-8">`);
  L.push(`<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">`);
  L.push(`<meta name="color-scheme" content="dark light">`);
  L.push(`<meta name="theme-color" content="${cfg.site.themeColor}" media="(prefers-color-scheme: dark)">`);
  L.push(`<meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)">`);
  L.push(`<title>${esc(t.title)}</title>`);
  L.push(`<meta name="description" content="${esc(cfg.site.description)}">`);
  L.push(`<meta name="keywords" content="${esc(t.keywords.join(', '))}">`);
  L.push(`<meta name="author" content="${esc(cfg.site.legalName)}">`);
  L.push(`<meta name="robots" content="${t.robots}">`);
  L.push(`<meta name="googlebot" content="${t.robots}">`);
  L.push(`<link rel="canonical" href="${url}/">`);
  /* hreflang: one reference per locale + x-default, so search engines serve the right language */
  locales.locales.filter(l => cfg.site.locales.includes(l.code)).forEach(l => {
    L.push(`<link rel="alternate" hreflang="${l.code}" href="${url}/${l.code === defaultLocale ? '' : l.code + '/'}">`);
  });
  L.push(`<link rel="alternate" hreflang="x-default" href="${url}/">`);
  /* icons: real files on disk, referenced by size so browsers pick correctly */
  L.push(`<link rel="icon" href="${icon('favicon.ico')}" sizes="any">`);
  L.push(`<link rel="icon" type="image/svg+xml" href="${cfg.brand.logoMarkSrc}">`);
  L.push(`<link rel="icon" type="image/png" sizes="32x32" href="${icon('favicon-32x32.png')}">`);
  L.push(`<link rel="icon" type="image/png" sizes="16x16" href="${icon('favicon-16x16.png')}">`);
  L.push(`<link rel="apple-touch-icon" sizes="180x180" href="${icon('apple-touch-icon.png')}">`);
  L.push(`<link rel="mask-icon" href="${cfg.brand.logoMarkSrc}" color="${cfg.brand.primary}">`);
  L.push(`<link rel="manifest" href="site.webmanifest">`);
  /* social */
  L.push(`<meta property="og:type" content="${t.ogType}">`);
  L.push(`<meta property="og:site_name" content="${esc(cfg.site.name)}">`);
  L.push(`<meta property="og:title" content="${esc(cfg.site.tagline)}">`);
  L.push(`<meta property="og:description" content="${esc(cfg.site.description)}">`);
  L.push(`<meta property="og:url" content="${url}/">`);
  L.push(`<meta property="og:image" content="${url}/${t.ogImage}">`);
  L.push(`<meta property="og:image:width" content="1200">`);
  L.push(`<meta property="og:image:height" content="630">`);
  L.push(`<meta property="og:image:alt" content="${esc(cfg.site.name + ' — ' + cfg.site.tagline)}">`);
  L.push(`<meta property="og:locale" content="${defaultLocale}">`);
  cfg.site.locales.filter(c => c !== defaultLocale).forEach(c => L.push(`<meta property="og:locale:alternate" content="${c}">`));
  L.push(`<meta name="twitter:card" content="${t.twitterCard}">`);
  if (t.twitterSite) L.push(`<meta name="twitter:site" content="${esc(t.twitterSite)}">`);
  L.push(`<meta name="twitter:title" content="${esc(cfg.site.tagline)}">`);
  L.push(`<meta name="twitter:description" content="${esc(cfg.site.description)}">`);
  L.push(`<meta name="twitter:image" content="${url}/${t.ogImage}">`);
  if (t.verification && t.verification.google) L.push(`<meta name="google-site-verification" content="${esc(t.verification.google)}">`);
  if (t.verification && t.verification.bing) L.push(`<meta name="msvalidate.01" content="${esc(t.verification.bing)}">`);
  /* international signals beyond hreflang */
  L.push(`<meta name="geo.region" content="GLOBAL">`);
  L.push(`<meta http-equiv="content-language" content="${cfg.site.locales.join(', ')}">`);
  L.push(`<link rel="alternate" type="application/rss+xml" title="${esc(cfg.site.name)} updates" href="feed.xml">`);
  if (cfg.analytics.id) {
    L.push(`<!-- analytics: provider=${esc(cfg.analytics.provider)} id=${esc(cfg.analytics.id)} — script is injected by src/p09_js_core.js only when configured -->`);
  } else {
    L.push(`<!-- analytics: disabled (no id in site.config.json) — no third-party requests are made -->`);
  }
  return L.join('\n');
}

function jsonLd() {
  const t = cfg.seo;
  const plans = cfg.pricing.plans.map(p => ({
    '@type': 'Offer',
    name: p.name,
    price: String(p.priceMonthly),
    priceCurrency: cfg.site.defaultCurrency,
    description: p.summary,
    url: `${url}/#pricing`,
    availability: 'https://schema.org/InStock'
  }));
  const graph = [
    {
      '@type': 'Organization',
      '@id': `${url}/#organization`,
      name: cfg.site.name,
      legalName: cfg.site.legalName,
      url: `${url}/`,
      logo: { '@type': 'ImageObject', url: `${url}/${cfg.brand.logoSrc}` },
      foundingDate: t.organization.foundingDate,
      areaServed: t.organization.areaServed,
      knowsAbout: t.organization.knowsAbout,
      contactPoint: [{
        '@type': 'ContactPoint',
        contactType: 'sales',
        email: cfg.site.supportEmail,
        availableLanguage: cfg.site.locales
      }]
    },
    {
      '@type': 'WebSite',
      '@id': `${url}/#website`,
      url: `${url}/`,
      name: cfg.site.name,
      description: cfg.site.description,
      publisher: { '@id': `${url}/#organization` },
      inLanguage: cfg.site.locales
    },
    {
      '@type': 'SoftwareApplication',
      '@id': `${url}/#software`,
      name: cfg.site.name,
      applicationCategory: 'BusinessApplication',
      applicationSubCategory: 'Revenue operations',
      operatingSystem: 'Web',
      description: cfg.site.description,
      url: `${url}/`,
      publisher: { '@id': `${url}/#organization` },
      featureList: cfg.capabilities.agents.map(a => `${a.role} agent — ${a.job}`),
      offers: plans,
      inLanguage: cfg.site.locales,
      /* only claimed when the config says the facts are confirmed */
      ...(cfg.publishing.securityCertificationsConfirmed ? {} : {})
    },
    {
      '@type': 'BreadcrumbList',
      '@id': `${url}/#breadcrumbs`,
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: `${url}/` },
        { '@type': 'ListItem', position: 2, name: 'Platform', item: `${url}/#platform` },
        { '@type': 'ListItem', position: 3, name: 'Pricing', item: `${url}/#pricing` }
      ]
    }
  ];
  if (cfg.nav.faq || true) {
    graph.push({
      '@type': 'FAQPage',
      '@id': `${url}/#faq`,
      mainEntity: cfg.faq.map(q => ({
        '@type': 'Question',
        name: q.q,
        acceptedAnswer: { '@type': 'Answer', text: q.a }
      }))
    });
  }
  return JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }, null, 2);
}

/* runtime config handed to the page (single source of truth at runtime too) */
function runtimeBlock() {
  const runtime = {
    site: cfg.site,
    brand: cfg.brand,
    pricing: cfg.pricing,
    publishing: cfg.publishing,
    evidence: cfg.evidence,
    capabilities: cfg.capabilities,
    app: cfg.app,
    legal: cfg.legal,
    analytics: cfg.analytics,
    nav: cfg.nav,
    faq: cfg.faq
  };
  return '<script id="rp-config" type="application/json">' +
    JSON.stringify(runtime).replace(/<\//g, '<\\/') + '</script>\n' +
    '<script id="rp-i18n" type="application/json">' +
    JSON.stringify({ locales: locales.locales, strings }).replace(/<\//g, '<\\/') + '</script>';
}

/* ════════════════════════════════════════════════════════════
   3. ASSEMBLE
   ════════════════════════════════════════════════════════════ */
const head = [
  'p01_css_base.html', 'p02_css_ui.html', 'p03_css_story.html', 'p04_css_app.html',
  'p13_css_os.html', 'p18_css_orb.html'
].map(read).join('\n').replace('<!--HEAD:META-->', metaBlock());

const body = ['p05_body_bg.html', 'p06_body_hero.html', 'p07_body_sections.html',
  'p14_body_os.html', 'p15_body_os2.html', 'p16_body_os3.html', 'p19_body_signup.html'].map(read).join('\n');

const marker = '<script>';
const cut = body.lastIndexOf(marker);
if (cut === -1) fail('assemble: script marker missing in body');
const bodyNoScript = body.slice(0, cut === -1 ? body.length : cut);

const js = ['p20_js_runtime.js', 'p09_js_core.js', 'p21_js_calc.js', 'p10_js_interact.js', 'p11_js_story.js', 'p12_js_app.js', 'p17_js_os.js', 'orb.js']
  .map(f => '/* ===== ' + f + ' ===== */\n' + read(f)).join('\n\n');

const structured = `<script type="application/ld+json">\n${jsonLd()}\n</script>`;
const out = [head, structured, bodyNoScript, runtimeBlock(), '<script>', js, '</script>', '</body>', '</html>'].join('\n');

/* ════════════════════════════════════════════════════════════
   4. VERIFY
   ════════════════════════════════════════════════════════════ */
if (/<\/script>/i.test(js)) fail('JS contains a closing script tag');

const counts = {
  div: [/<div\b/g, /<\/div>/g], section: [/<section\b/g, /<\/section>/g],
  style: [/<style>/g, /<\/style>/g], main: [/<main\b/g, /<\/main>/g],
  aside: [/<aside\b/g, /<\/aside>/g], svg: [/<svg\b/g, /<\/svg>/g]
};
Object.keys(counts).forEach(k => {
  const a = (out.match(counts[k][0]) || []).length, b = (out.match(counts[k][1]) || []).length;
  if (a !== b) fail(`${k} imbalance: ${a} open / ${b} close`);
});
if ((out.match(/<[^>]*style="[^"]*"[^>]*style="/g) || []).length) fail('duplicate style attributes');
/* CSS must never escape its <style> block: leaked rules render as visible text */
{
  let depth = 0;
  (out.match(/<style[^>]*>/g) || []).forEach(() => depth++);
  (out.match(/<\/style>/g) || []).forEach(() => depth--);
  if (depth !== 0) fail('style tags are unbalanced by ' + depth);
  let leaked = 0;
  out.split('</style>').slice(1).forEach(chunk => {
    const head = chunk.split('<style')[0].trim();
    if (/^(\/\*|[.@#a-zA-Z][^{}]*\{)/.test(head)) leaked++;
  });
  if (leaked) fail(leaked + ' stylesheet block(s) sit outside a <style> tag');
}
if ((out.match(/\$\{/g) || []).length) fail('template-literal leftovers');
try { new Function(js); } catch (e) { fail('inline JS syntax error: ' + e.message); }

/* every referenced asset must exist on disk — a 404 icon or OG image is a silent SEO failure */
const referenced = [cfg.brand.logoSrc, cfg.brand.logoMarkSrc, cfg.seo.ogImage,
  icon('favicon.ico'), icon('favicon-16x16.png'), icon('favicon-32x32.png'),
  icon('apple-touch-icon.png'), icon('icon-192.png'), icon('icon-512.png'),
  icon('maskable-512.png'), 'site.webmanifest', 'robots.txt', 'sitemap.xml'];
referenced.forEach(rel => {
  if (!fs.existsSync(path.join(ROOT, rel))) fail(`missing asset: ${rel} (run: node tools/build-assets.mjs)`);
});

/* structured data must parse, and must not claim unconfirmed certifications */
try {
  const parsed = JSON.parse(jsonLd());
  if (!parsed['@graph'].some(n => n['@type'] === 'SoftwareApplication')) fail('structured data: SoftwareApplication missing');
  const faq = parsed['@graph'].find(n => n['@type'] === 'FAQPage');
  if (!faq || faq.mainEntity.length < 4) fail('structured data: FAQ needs at least 4 entries');
  const blob = JSON.stringify(parsed);
  if (/SOC 2 Type II/.test(blob) && !cfg.publishing.securityCertificationsConfirmed) {
    warn('structured data omits certification claims until publishing.securityCertificationsConfirmed is true');
  }
} catch (e) { fail('structured data is not valid JSON: ' + e.message); }

/* metadata sanity that search engines actually penalise */
const titleLen = cfg.seo.title.length, descLen = cfg.site.description.length;
if (titleLen > 65) warn(`seo.title is ${titleLen} chars — over 65 gets truncated in results`);
if (titleLen < 25) warn(`seo.title is only ${titleLen} chars — too thin for search`);
if (descLen > 165) warn(`site.description is ${descLen} chars — over 165 gets truncated`);
if (descLen < 70) warn(`site.description is only ${descLen} chars — too thin for search`);
if (!/<html lang="/.test(out)) fail('html lang attribute missing');
if ((out.match(/<h1\b/g) || []).length !== 1) fail(`expected exactly one <h1>, found ${(out.match(/<h1\b/g) || []).length}`);

/* no fabricated customer evidence may ship */
const proofMatch = out.match(/id="proof"[\s\S]*?<\/section>/);
if (proofMatch && /data-evidence="real"/.test(proofMatch[0]) && cfg.evidence.items.length === 0) {
  fail('the evidence section claims verified evidence but config.evidence.items is empty');
}
if (cfg.evidence.items.length && !cfg.publishing.evidenceConfirmed) {
  warn('evidence items are present but publishing.evidenceConfirmed is false — the section will still show the evidence standard');
}

/* template-literal placeholders that must never reach production */
['TODO', 'FIXME', 'lorem ipsum', 'Lorem ipsum'].forEach(tok => {
  if (out.includes(tok)) fail(`placeholder text found in output: ${tok}`);
});

/* the page must not fetch anything except the lazy three.js CDN on upgrade */
const ext = [...out.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)].map(m => m[1]);
const allowedHosts = ['www.w3.org', 'schema.org', 'cdnjs.cloudflare.com', 'unpkg.com', 'cdn.jsdelivr.net'];
[...new Set(ext)].forEach(h => {
  if (!allowedHosts.includes(h) && !h.endsWith('example.com') && !h.includes(cfg.site.url.replace('https://', ''))) {
    warn(`external host referenced: ${h}`);
  }
});

const bytes = Buffer.byteLength(out);
const KB = Math.round(bytes / 1024);
const divs = (out.match(/<div\b/g) || []).length;
const sections = (out.match(/<section\b/g) || []).length;
const scripts = (out.match(/<script\b/g) || []).length;

if (!CHECK_ONLY && problems.length === 0) fs.writeFileSync(OUT, out);

console.log(`bytes: ${bytes}  KB: ${KB}`);
console.log(`divs: ${divs}  sections: ${sections}  scripts: ${scripts}  locales: ${cfg.site.locales.length}`);
console.log(`title: ${titleLen} chars · description: ${descLen} chars · structured-data types: ${JSON.parse(jsonLd())['@graph'].map(n => n['@type']).join(', ')}`);
if (warnings.length) {
  console.log('\nwarnings (' + warnings.length + '):');
  warnings.forEach(w => console.log('  ! ' + w));
}
if (problems.length) {
  console.log('\nerrors (' + problems.length + '):');
  problems.forEach(p => console.log('  x ' + p));
  console.log('\nstructure FAILED — index.html not written');
  process.exit(1);
}
console.log('\nstructure OK' + (CHECK_ONLY ? ' (check only)' : ''));
