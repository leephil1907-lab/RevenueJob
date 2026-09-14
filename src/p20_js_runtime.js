/* ============================================================
   REVENUEPILOT — RUNTIME: configuration, internationalisation
   ------------------------------------------------------------
   Everything the page displays as a *fact* comes from the config block that
   assemble.js generates out of site.config.json, and every string of chrome
   comes from i18n/strings.json. Nothing in here invents data: the page ships no
   sample metrics, no fabricated customers and no simulated activity.

   Exposes: RP.cfg, RP.i18n, RP.t(), RP.money(), RP.setLocale()
   ============================================================ */
(function () {
  'use strict';

  const readJSON = id => {
    const el = document.getElementById(id);
    if (!el) return null;
    try { return JSON.parse(el.textContent); } catch (e) { return null; }
  };

  const cfg = readJSON('rp-config') || {};
  const bundle = readJSON('rp-i18n') || { locales: [{ code: 'en', name: 'English', dir: 'ltr', currency: 'USD' }], strings: { en: {} } };

  const LOCALES = Array.isArray(bundle.locales) && bundle.locales.length
    ? bundle.locales
    : [{ code: 'en', name: 'English', dir: 'ltr', currency: 'USD' }];
  const STRINGS = bundle.strings || { en: {} };

  const byCode = {};
  LOCALES.forEach(l => { byCode[l.code] = l; });

  /* ------------------------------------------------------------
     Locale state. Resolution order: explicit choice → browser → default.
     ------------------------------------------------------------ */
  const DEFAULT_LOCALE = (cfg.site && cfg.site.defaultLocale) || 'en';
  const STORE_KEY = 'rp.locale';
  const URL_PARAM = 'lang';

  function detect() {
    /* an explicit ?lang= wins so links can be shared in a language */
    try {
      const q = new URLSearchParams(window.location.search).get(URL_PARAM);
      if (q && byCode[q]) return q;
    } catch (e) { /* no URL support in this environment */ }
    try {
      const saved = window.localStorage.getItem(STORE_KEY);
      if (saved && byCode[saved]) return saved;
    } catch (e) { /* storage blocked — fine */ }
    const nav = (navigator.languages && navigator.languages[0]) || navigator.language || '';
    const short = String(nav).split('-')[0].toLowerCase();
    if (byCode[short]) return short;
    return DEFAULT_LOCALE;
  }

  let locale = detect();
  const listeners = [];

  function t(key, vars) {
    const table = STRINGS[locale] || STRINGS[DEFAULT_LOCALE] || {};
    let s = table[key];
    if (s === undefined) s = (STRINGS[DEFAULT_LOCALE] || {})[key];
    if (s === undefined) return key;                    // visible, so a missing key is obvious
    if (vars) Object.keys(vars).forEach(k => { s = s.replace(new RegExp('\\{' + k + '\\}', 'g'), vars[k]); });
    return s;
  }

  /* Currency and number formatting follow the active locale's currency unless a
     workspace currency is explicitly chosen (the OS console has that control). */
  let currencyOverride = null;
  function activeCurrency() {
    if (currencyOverride) return currencyOverride;
    const l = byCode[locale];
    return (l && l.currency) || (cfg.site && cfg.site.defaultCurrency) || 'USD';
  }
  function money(value, opts) {
    const o = opts || {};
    const cur = o.currency || activeCurrency();
    const amount = Number(value) || 0;
    try {
      return new Intl.NumberFormat(locale === 'ar' ? 'ar-AE' : locale, {
        style: 'currency', currency: cur,
        maximumFractionDigits: o.decimals === undefined ? 0 : o.decimals,
        minimumFractionDigits: o.decimals === undefined ? 0 : o.decimals
      }).format(amount);
    } catch (e) {
      return cur + ' ' + amount.toLocaleString('en-US');
    }
  }
  function num(value, opts) {
    const o = opts || {};
    try {
      return new Intl.NumberFormat(locale, { maximumFractionDigits: o.decimals === undefined ? 0 : o.decimals }).format(Number(value) || 0);
    } catch (e) { return String(Math.round(Number(value) || 0)); }
  }
  function date(value) {
    const d = value instanceof Date ? value : new Date(value);
    try {
      return new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'short', day: 'numeric' }).format(d);
    } catch (e) { return d.toDateString(); }
  }

  /* ------------------------------------------------------------
     Applying a locale to the document
     ------------------------------------------------------------ */
  function apply() {
    const l = byCode[locale] || byCode[DEFAULT_LOCALE];
    const html = document.documentElement;
    html.setAttribute('lang', locale);
    html.setAttribute('dir', l && l.dir === 'rtl' ? 'rtl' : 'ltr');
    html.classList.toggle('rtl', !!(l && l.dir === 'rtl'));

    /* every element that carries a translation key */
    const nodes = document.querySelectorAll('[data-i18n]');
    for (let i = 0; i < nodes.length; i++) {
      const el = nodes[i];
      const key = el.getAttribute('data-i18n');
      const attr = el.getAttribute('data-i18n-attr');
      const value = t(key);
      if (attr) el.setAttribute(attr, value);
      else el.textContent = value;
    }
    /* placeholders that need translating */
    const phs = document.querySelectorAll('[data-i18n-placeholder]');
    for (let i = 0; i < phs.length; i++) {
      phs[i].setAttribute('placeholder', t(phs[i].getAttribute('data-i18n-placeholder')));
    }

    /* reflect the choice in every language control on the page */
    document.querySelectorAll('[data-lang-select]').forEach(sel => {
      if (sel.value !== locale) sel.value = locale;
    });
    document.querySelectorAll('[data-lang-code]').forEach(el => { el.textContent = locale.toUpperCase(); });
    document.querySelectorAll('[data-lang-name]').forEach(el => { el.textContent = (byCode[locale] || {}).native || locale; });

    listeners.forEach(fn => { try { fn(locale, l); } catch (e) { } });
  }

  function setLocale(next) {
    if (!byCode[next] || next === locale) return;
    locale = next;
    try { window.localStorage.setItem(STORE_KEY, next); } catch (e) { }
    apply();
  }

  function setCurrency(code) {
    currencyOverride = code || null;
    listeners.forEach(fn => { try { fn(locale, byCode[locale]); } catch (e) { } });
  }

  window.RP = window.RP || {};
  window.RP.cfg = cfg;
  window.RP.theme = { get: currentTheme, set: t => applyTheme(t, true), apply: () => applyTheme(currentTheme(), false) };
  window.RP.i18n = {
    locales: LOCALES,
    strings: STRINGS,
    get locale() { return locale; },
    get dir() { return (byCode[locale] || {}).dir || 'ltr'; },
    get currency() { return activeCurrency(); },
    set: setLocale,
    setCurrency: setCurrency,
    t: t,
    money: money,
    num: num,
    date: date,
    apply: apply,
    on: fn => listeners.push(fn)
  };
  /* convenience aliases used across the codebase */
  window.RP.t = t;
  window.RP.money = money;
  window.RP.num = num;

  /* language controls anywhere on the page */
  document.addEventListener('change', e => {
    const sel = e.target.closest && e.target.closest('[data-lang-select]');
    if (sel) setLocale(sel.value);
  });
  document.addEventListener('click', e => {
    const btn = e.target.closest && e.target.closest('[data-lang-set]');
    if (btn) { e.preventDefault(); setLocale(btn.getAttribute('data-lang-set')); }
  });

  /* ------------------------------------------------------------
     Language menus — the same global list powers the header dropdown and the
     mobile sheet, so a locale added to i18n/locales.json appears everywhere.
     ------------------------------------------------------------ */
  function buildMenus() {
    const menu = document.getElementById('langMenu');
    const btn = document.getElementById('langBtn');
    if (menu && !menu.dataset.built) {
      menu.dataset.built = '1';
      menu.innerHTML = LOCALES.map(l =>
        '<button role="option" class="lang-item" data-lang-set="' + l.code + '" aria-selected="' + (l.code === locale) + '">' +
        '<span class="lang-nat">' + l.native + '</span>' +
        '<span class="lang-code">' + l.code.toUpperCase() + '</span>' +
        (l.status && l.status !== 'reviewed' ? '<span class="lang-flag" title="Needs native review">draft</span>' : '') +
        '</button>').join('');
    }
    if (btn && !btn.dataset.built) {
      btn.dataset.built = '1';
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const open = menu.hasAttribute('hidden');
        if (open) menu.removeAttribute('hidden'); else menu.setAttribute('hidden', '');
        btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
      document.addEventListener('click', () => {
        if (menu && !menu.hasAttribute('hidden')) {
          menu.setAttribute('hidden', '');
          btn.setAttribute('aria-expanded', 'false');
        }
      });
      document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && menu && !menu.hasAttribute('hidden')) {
          menu.setAttribute('hidden', '');
          btn.setAttribute('aria-expanded', 'false');
          btn.focus();
        }
      });
    }
    const sheet = document.getElementById('sheetLangs');
    if (sheet && !sheet.dataset.built) {
      sheet.dataset.built = '1';
      sheet.innerHTML = LOCALES.map(l =>
        '<button class="chip" data-lang-set="' + l.code + '">' + l.native + '</button>').join('');
    }
    /* keep aria-selected in step with the active locale */
    if (menu) {
      menu.querySelectorAll('[data-lang-set]').forEach(b =>
        b.setAttribute('aria-selected', b.getAttribute('data-lang-set') === locale ? 'true' : 'false'));
    }
  }

  /* ------------------------------------------------------------
     THEME — light / dark, remembered per visitor, applied to <html>
     ------------------------------------------------------------ */
  const THEME_KEY = 'rp.theme';
  const themeMeta = () => document.querySelector('meta[name="theme-color"]');

  function currentTheme() {
    return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
  }
  function applyTheme(next, remember) {
    const t = next === 'light' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', t);
    if (remember) {
      document.documentElement.setAttribute('data-theme-source', 'choice');
      try { localStorage.setItem(THEME_KEY, t); } catch (e) { /* storage blocked */ }
    }
    /* the browser chrome follows the page */
    const m = themeMeta();
    const colour = t === 'light' ? ((cfg.site && cfg.brand && cfg.brand.lightThemeColor) || '#ffffff') : ((cfg.brand && cfg.brand.themeColor) || '#0b1220');
    if (m) m.setAttribute('content', colour);
    document.querySelectorAll('[data-theme-toggle]').forEach(b =>
      b.setAttribute('aria-pressed', t === 'light' ? 'true' : 'false'));
    if (window.RP && window.RP.orb && window.RP.orb.onTheme) { try { window.RP.orb.onTheme(t); } catch (e) {} }
  }
  function buildTheme() {
    document.querySelectorAll('[data-theme-toggle]').forEach(btn => {
      if (btn.dataset.built) return;
      btn.dataset.built = '1';
      btn.addEventListener('click', () => applyTheme(currentTheme() === 'light' ? 'dark' : 'light', true));
    });
    /* if the visitor has never chosen, keep following the system */
    if (window.matchMedia) {
      const mq = window.matchMedia('(prefers-color-scheme: light)');
      const onChange = () => {
        if (document.documentElement.getAttribute('data-theme-source') === 'choice') return;
        applyTheme(mq.matches ? 'light' : 'dark', false);
      };
      if (mq.addEventListener) mq.addEventListener('change', onChange);
      else if (mq.addListener) mq.addListener(onChange);
    }
    document.querySelectorAll('[data-theme-set]').forEach(a => {
      a.addEventListener('click', e => { e.preventDefault(); applyTheme(a.getAttribute('data-theme-set'), true); });
    });
    applyTheme(currentTheme(), false);
  }

  function bootRuntime() { buildTheme(); buildMenus(); apply(); }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bootRuntime);
  else bootRuntime();
})();
