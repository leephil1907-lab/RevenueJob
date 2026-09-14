// ============================================================================
// Production suite: boots index.html in jsdom and asserts the contract that
// matters now —
//   1. no fabricated data ships anywhere (no invented customers, metrics or
//      simulated activity),
//   2. everything factual comes from site.config.json,
//   3. the interactive surfaces actually compute,
//   4. internationalisation works from the global locale list,
//   5. the console behaves (empty states, kill switch, audit trail).
// ============================================================================
const fs = require('fs');
const path = require('path');
const { join } = path;
const ROOT = __dirname;   // this suite runs from the checkout it belongs to
const { JSDOM, VirtualConsole } = require('jsdom');

const html = fs.readFileSync(join(ROOT, 'index.html'), 'utf8');
const cfg = JSON.parse(fs.readFileSync(join(ROOT, 'site.config.json'), 'utf8'));
const locales = JSON.parse(fs.readFileSync(join(ROOT, 'i18n/locales.json'), 'utf8')).locales;
const strings = JSON.parse(fs.readFileSync(join(ROOT, 'i18n/strings.json'), 'utf8'));

const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', e => { if (!/Not implemented/i.test((e && e.message) || '')) errors.push('jsdomError: ' + (e && e.message)); });
vc.on('error', (...a) => errors.push('console.error: ' + a.join(' ')));

const dom = new JSDOM(html, {
  runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc, url: 'https://example.com/',
  beforeParse(win) {
    win.matchMedia = q => ({
      matches: /prefers-reduced-motion/.test(q) ? false
        : /pointer:\s*coarse/.test(q) ? false
          : /hover:\s*hover/.test(q) ? true : false,
      media: q, addListener() { }, removeListener() { }, addEventListener() { }, removeEventListener() { }
    });
    win.IntersectionObserver = class { constructor(cb) { this.cb = cb; } observe() { } unobserve() { } disconnect() { } };
    win.ResizeObserver = class { observe() { } unobserve() { } disconnect() { } };
    win.requestAnimationFrame = cb => setTimeout(() => cb(performance.now()), 16);
    win.cancelAnimationFrame = id => clearTimeout(id);
    win.requestIdleCallback = cb => setTimeout(() => cb({ didTimeout: false }), 10);
    const ctxStub = new Proxy({}, {
      get(t, k) {
        if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => ({ addColorStop() { } });
        if (k === 'canvas') return { width: 100, height: 100 };
        return () => { };
      }, set() { return true; }
    });
    win.HTMLCanvasElement.prototype.getContext = () => ctxStub;
    win.SVGElement.prototype.getTotalLength = () => 120;
    win.SVGElement.prototype.getPointAtLength = () => ({ x: 10, y: 10 });
    win.Element.prototype.getBoundingClientRect = () =>
      ({ top: 100, left: 0, right: 900, bottom: 400, width: 900, height: 300, x: 0, y: 100 });
  }
});

const win = dom.window, doc = win.document;
const results = [];
const ok = (l, c, x) => results.push((c ? 'PASS  ' : 'FAIL  ') + l + (x ? '  → ' + x : ''));
const click = el => el && el.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
const type = (el, v) => { el.value = v; el.dispatchEvent(new win.Event('input', { bubbles: true })); };
const txt = sel => { const el = doc.querySelector(sel); return el ? el.textContent.trim() : ''; };
const num = s => parseFloat(String(s).replace(/[^0-9.]/g, '')) || 0;

setTimeout(() => {
  const R = win.RP;

  /* ════ 1. runtime wiring ════ */
  ok('runtime exposed', !!R && !!R.cfg && !!R.i18n && !!R.calc);
  ok('config reached the page', R.cfg.site && R.cfg.site.name === cfg.site.name);
  ok('calculator model exposed', typeof R.calc.model === 'function');
  ok('OS controller exposed', !!(R.os && R.os.showPane));
  ok('orb present', !!doc.querySelector('#orbStage'));
  ok('no runtime errors on boot', errors.length === 0, errors.slice(0, 2).join(' | '));

  /* ════ 2. no fabricated data ════ */
  const invented = ['Priya Raman', 'Northwind Labs', 'Helios Freight', 'Quill & Co', 'Meridian Health',
    'Volta Energy', 'Cobalt Systems', 'Atlas Retail', 'Beacon Legal', 'Vantage Systems',
    'Dana Whitfield', 'Ledgerline', 'John Smith', 'Example Corporation'];
  invented.forEach(n => ok('no invented entity: ' + n, html.indexOf(n) === -1,
    html.indexOf(n) > -1 ? 'found at ' + html.indexOf(n) : ''));

  const inventedNumbers = ['$128,430', '$482,000', '$173,400', '$96,200', '447×', '8,421', '3,920', '1,842',
    '$184,200', '$84,300', '$612,000', '2,847', '00:14:22', '38s', '94%', 'Score 94'];
  inventedNumbers.forEach(n => ok('no invented figure: ' + n, html.indexOf(n) === -1));

  ok('no demo counter ramps remain', (html.match(/data-count="\d+"/g) || []).length === 0,
    (html.match(/data-count="\d+"/g) || []).length + ' found');
  ok('no simulated activity loop in the page source',
    !/pushProspect|liveFeed|traceMs|queueCount/.test(html));
  /* every "product preview" surface is gone, not relabelled */
  ok('no demo/preview badges remain', !/Demo data|Simulated call|demo-tag/.test(html),
    (html.match(/Demo data|Simulated call|demo-tag/g) || []).join(', '));
  ok('no invented prospect or queue counts remain',
    !/in-market accounts|\d+ queued|\d+ exceptions open|\d+ open · \d+ unread|Median review time <b>\d/.test(html));
  ok('no premade agent name ships in the markup', !/<option[^>]*>?Alex|>Alex ·|"Alex"/.test(html));
  ok('no placeholder company names ship in the console',
    !/\[Company\]<\/option>/.test(html) && !/#intelName">\[Company\]/.test(html));
  ok('workspace names are the visitor\'s own', /Your workspace/.test(html));
  ok('the console states the data source honestly',
    /No source connected/.test(html) && !!doc.getElementById('osSource'));
  ok('approvals queue starts empty, not pre-filled',
    (txt('#cntMsgs') || '') === '0' && !!doc.getElementById('apprStatus'));
  ok('forecast cards carry no premade money values',
    (html.match(/data-money="[0-9]/g) || []).length === 0,
    (html.match(/data-money="[0-9]+"/g) || []).join(', '));
  ok('no fabricated revenue ticker in the shipped script',
    !/128430|orbRev/.test(html));

  ok('hero copy still verbatim', /Your AI revenue/.test(txt('#heroTitle')) && /Always working/.test(txt('#heroTitle')));
  ok('the page states it ships no demo figures', /No demo figures/.test(doc.body.textContent) ||
    /no demo figures/i.test(doc.body.textContent));

  /* the copilot dry run: input in, honest read out */
  R.os.showPane('copilot');
  const copIn = doc.getElementById('copInput');
  ok('copilot takes the prospect\'s own words', !!copIn);
  if (copIn) {
    copIn.value = 'This looks useful but the pricing is too expensive for us right now.';
    copIn.dispatchEvent(new win.Event('input', { bubbles: true }));
    ok('copilot names the objection from the text', /Price|budget/i.test(txt('#copObj')), txt('#copObj'));
    ok('copilot reads sentiment from the text', /Negative|Mixed/.test(txt('#copSentLab')), txt('#copSentLab'));
    ok('copilot proposes an action and a draft', txt('#copNext').length > 8 && txt('#copReply').length > 40);
    ok('copilot echoes what was pasted instead of a script', /pricing is too expensive/.test(txt('#copTranscript')));
    ok('copilot leaves the claim blanks to the seller', /\[/.test(txt('#copReply')));
    copIn.value = '';
    copIn.dispatchEvent(new win.Event('input', { bubbles: true }));
    ok('clearing the box clears the read', txt('#copObj') === '—' && txt('#copSentLab') === '—');
  }
  ok('no scripted call transcript ships in the markup', !/00:14:22|Dana|CFO signed off/.test(html));

  /* ════ 3. config-driven facts ════ */
  const facts = { agents: cfg.capabilities.agents.length, permissions: cfg.capabilities.permissions.length,
    autonomy: cfg.capabilities.autonomyLevels.length, locales: cfg.site.locales.length };
  Object.keys(facts).forEach(k => {
    const el = doc.querySelector('[data-fact="' + k + '"]');
    ok('fact rendered from config: ' + k, el && num(el.textContent) === facts[k],
      el ? el.textContent : 'missing element');
  });

  const roster = doc.querySelectorAll('[data-agent-roster] .roster-row');
  ok('agent roster lists every configured role', roster.length === cfg.capabilities.agents.length,
    roster.length + ' rows');
  const perms = doc.querySelectorAll('[data-permission-list] .perm-row');
  ok('permission policies listed from config', perms.length === cfg.capabilities.permissions.length,
    perms.length + ' rows');

  const tiers = doc.querySelectorAll('.tier');
  ok('pricing tiers match config', tiers.length === cfg.pricing.plans.length, tiers.length + ' tiers');
  const firstPrice = cfg.pricing.plans[0].priceMonthly;
  ok('pricing figures come from config', html.indexOf(String(firstPrice)) > -1);
  ok('pricing is labelled when unconfirmed',
    cfg.publishing.pricesConfirmed ? true : /Illustrative|not a published/i.test(doc.querySelector('#pricing').textContent));

  /* ════ 4. the calculator computes ════ */
  const calcRoot = doc.querySelector('[data-calc-root]');
  ok('calculator root present', !!calcRoot);
  ok('calculator starts empty (ships no numbers)',
    ['prospects', 'qual', 'conv', 'meet', 'close', 'deal'].every(k => {
      const el = calcRoot.querySelector('[data-calc="' + k + '"]');
      return el && el.value === '';
    }));
  ok('empty state says so', /Enter your numbers|arithmetic/i.test(txt('[data-out="note"]')));

  type(calcRoot.querySelector('[data-calc="prospects"]'), '500');
  type(calcRoot.querySelector('[data-calc="qual"]'), '20');
  type(calcRoot.querySelector('[data-calc="conv"]'), '50');
  type(calcRoot.querySelector('[data-calc="meet"]'), '40');
  type(calcRoot.querySelector('[data-calc="close"]'), '25');
  type(calcRoot.querySelector('[data-calc="deal"]'), '8000');

  const model = R.calc.model();
  ok('model computed from inputs', model.qualified === 100 && model.conversations === 50 &&
    model.meetings === 20 && model.deals === 5, JSON.stringify({ q: model.qualified, m: model.meetings, d: model.deals }));
  ok('expected revenue = deals × deal size', model.expected === 40000, String(model.expected));
  ok('weighted pipeline = expected ÷ close rate', model.pipeline === 160000, String(model.pipeline));
  ok('chain renders the qualified value', num(txt('[data-out="qualified"]')) === 100, txt('[data-out="qualified"]'));
  ok('chain renders expected revenue', /40,000/.test(txt('[data-out="expected"]')), txt('[data-out="expected"]'));
  ok('result sentence is written from the model', /100|5|40,000/.test(txt('[data-out="note"]')));

  /* mirrors: hero stats, dashboard preview, console */
  const mirrors = doc.querySelectorAll('[data-mirror="expected"]');
  ok('model mirrors into every surface that shows money', mirrors.length >= 4, mirrors.length + ' mirrors');
  ok('mirrors show the computed value, not a scripted one',
    Array.prototype.every.call(mirrors, el => /40,000|—/.test(el.textContent) || el.textContent.trim() === ''),
    Array.prototype.map.call(mirrors, el => el.textContent.trim()).slice(0, 4).join(' / '));

  /* example + clear round trip */
  click(calcRoot.querySelector('[data-calc-example]'));
  ok('example values are opt-in and labelled', num(calcRoot.querySelector('[data-calc="prospects"]').value) === 500);
  click(calcRoot.querySelector('[data-calc-clear]'));
  ok('clearing removes every value', ['prospects', 'qual', 'conv', 'meet', 'close', 'deal']
    .every(k => calcRoot.querySelector('[data-calc="' + k + '"]').value === ''));
  ok('model returns to empty', R.calc.model().isEmpty === true);

  /* edge cases must not produce NaN or Infinity on screen */
  type(calcRoot.querySelector('[data-calc="prospects"]'), '0');
  type(calcRoot.querySelector('[data-calc="close"]'), '0');
  type(calcRoot.querySelector('[data-calc="deal"]'), '0');
  ok('zero inputs do not produce NaN', !/NaN|Infinity/.test(calcRoot.textContent), calcRoot.textContent.slice(0, 80));
  R.calc.clear();

  /* ════ 5. i18n from the global list ════ */
  const menu = doc.querySelector('#langMenu');
  ok('language menu built from the global locale list',
    menu && menu.querySelectorAll('[data-lang-set]').length === locales.length,
    menu ? menu.querySelectorAll('[data-lang-set]').length + ' entries' : 'missing');
  ok('draft locales are labelled as drafts', menu && menu.querySelectorAll('.lang-flag').length >= 5);

  R.i18n.set('ar');
  ok('arabic switches the document direction', doc.documentElement.getAttribute('dir') === 'rtl');
  ok('arabic sets lang', doc.documentElement.getAttribute('lang') === 'ar');
  ok('arabic translates chrome', txt('#nav .nav-link') !== 'Product', txt('#nav .nav-link'));
  ok('arabic header shows the code', /AR/.test(doc.querySelector('[data-lang-code]').textContent));
  R.i18n.set('fr');
  ok('french restores ltr', doc.documentElement.getAttribute('dir') === 'ltr');
  ok('french translates the CTA', /Déployer/.test(doc.querySelector('[data-open-signup]').textContent),
    doc.querySelector('[data-open-signup]').textContent.trim().slice(0, 40));
  ok('strings come from i18n/strings.json', doc.querySelector('[data-i18n="nav.pricing"]').textContent === strings.fr['nav.pricing']);
  R.i18n.set('en');

  /* currency follows the locale, and the console can override it */
  ok('currency resolution works', R.i18n.currency === 'USD', R.i18n.currency);
  R.i18n.setCurrency('EUR');
  ok('currency override formats in EUR', /€|EUR/.test(R.i18n.money(1000)), R.i18n.money(1000));
  R.i18n.setCurrency(null);

  /* ════ 6. OS console ════ */
  const agents = doc.querySelectorAll('#osAgentGrid .agent-card');
  ok('agent fleet lists every configured role, none invented',
    agents.length === cfg.capabilities.agents.length, agents.length + ' cards');
  ok('agents report idle rather than a fake status',
    /idle/i.test(doc.querySelector('#osAgentGrid').textContent));

  /* approvals + inbox + prospects must state emptiness honestly */
  ok('approvals show an empty state, not fabricated items',
    /Nothing is waiting for approval/i.test(txt('#apprList')));
  ok('approval counters read zero', txt('#cntMsgs') === '0' && txt('#cntHigh') === '0');
  ok('inbox lists configured channels', doc.querySelectorAll('#inboxChannels .chn').length === cfg.capabilities.channels.length);
  ok('conversations show an empty state', /No conversations yet/i.test(txt('#convList')));
  ok('prospect table shows an empty state', /Import a list/i.test(txt('#consoleTable')));
  ok('supervisor exception queue is empty, not invented', /nothing to summarise|waiting for a workspace/i.test(txt('#supSummary')));

  /* permission matrix is interactive and audited */
  const permSel = doc.querySelector('#permMatrix select[data-perm]');
  ok('permission matrix renders controls from config', !!permSel);
  if (permSel) {
    permSel.value = 'limited';
    permSel.dispatchEvent(new win.Event('change', { bubbles: true }));
    ok('changing a permission is written to the audit log',
      /Permission changed/.test(txt('#auditLog')), txt('#auditLog').slice(0, 60));
  }

  /* kill switch cascade */
  click(doc.querySelector('#killSwitch'));
  ok('kill switch pauses the fleet', R.os.state.paused === true);
  ok('banner announces the pause', /PAUSED|paused/i.test(txt('#osBanner')) || doc.querySelector('#osBanner').classList.contains('on'));
  ok('label flips to resume', /Resume/i.test(txt('#killLabel')), txt('#killLabel'));
  ok('supervisor reports the pause', /paused/i.test(txt('#supMeta')), txt('#supMeta'));
  click(doc.querySelector('#killSwitch'));
  ok('resuming restores operation', R.os.state.paused === false && /armed|ready/i.test(txt('#supMeta')));

  /* audit trail records the visitor, labelled as such */
  ok('audit log explains it records the visitor', /your own actions/i.test(txt('#auditLog')) || /Console opened/.test(txt('#auditLog')));
  ok('activity timeline mirrors the audit trail', doc.querySelectorAll('#osActivity .logline').length > 0);

  /* developers pane from config */
  R.os.showPane('developers');
  ok('API endpoints listed from config',
    doc.querySelectorAll('#apiList .api-row').length === cfg.capabilities.api.endpoints.length,
    doc.querySelectorAll('#apiList .api-row').length + ' endpoints');
  ok('webhooks listed from config',
    doc.querySelectorAll('#whList .wh-row').length === cfg.capabilities.api.webhooks.length);
  ok('endpoint detail renders', /\/agents|\/prospects/.test(txt('#apiTitle')), txt('#apiTitle'));

  /* ════ global lists: config + i18n drive every menu ════ */
  R.os.showPane('command');
  const curSel = doc.getElementById('osCurrency');
  ok('currency menu is the configured list', !!curSel && curSel.options.length === cfg.site.currencies.length,
    (curSel ? curSel.options.length : 'none') + ' vs ' + cfg.site.currencies.length);
  const langSel = doc.getElementById('osLang');
  ok('console language menu is the i18n registry', !!langSel && langSel.options.length === cfg.site.locales.length,
    (langSel ? langSel.options.length : 'none') + ' options');
  ok('currency options carry real symbols', !!curSel && /[$€£¥₦]|د\.إ|R\$|₹|R\b|A\$|C\$/.test(curSel.options[0].textContent),
    curSel ? curSel.options[0].textContent : '');
  ok('agent specialisation list comes from the roster',
    doc.querySelectorAll('#agentSpec option').length >= cfg.capabilities.agents.length);
  ok('agent working language list comes from the i18n registry',
    doc.querySelectorAll('#agentLang option').length === cfg.site.locales.length);

  /* trust pane states certification status honestly */
  R.os.showPane('trust');
  ok('security controls render', doc.querySelectorAll('#trustGrid .trust-card').length === cfg.capabilities.security.length);
  ok('certifications show their real status rather than a claim',
    /In progress|Supported|Planned/.test(txt('#dataControls')));
  ok('AI controls listed', doc.querySelectorAll('#aiControls .ctl-list li').length >= 5);

  /* marketplace from config */
  R.os.showPane('marketplace');
  ok('templates render from config',
    doc.querySelectorAll('#mkTemplates .mk-card').length === cfg.capabilities.templates.length,
    doc.querySelectorAll('#mkTemplates .mk-card').length + ' templates');

  /* builder maths is traceable */
  R.os.showPane('builder');
  const goal = doc.querySelector('#goal');
  if (goal) {
    goal.value = '50000';
    goal.dispatchEvent(new win.Event('input', { bubbles: true }));
    ok('goal slider converts to conversations using the visitor model',
      /conversations|conversion rates/i.test(txt('#goalVal')), txt('#goalVal').slice(0, 70));
  }
  const autonomy = doc.querySelector('#autonomy');
  if (autonomy) {
    autonomy.value = '10';
    autonomy.dispatchEvent(new win.Event('input', { bubbles: true }));
    ok('autonomy slider maps to the published ladder levels',
      /Draft only/i.test(txt('#autonomyLab')), txt('#autonomyLab'));
  }
  ok('agent cost is shown as arithmetic, not a claim',
    /actions/.test(txt('#estCost')), txt('#estCost'));
  ok('agent working language set from the global list',
    doc.querySelectorAll('#agentLang option').length === locales.length);

  /* builder → model wiring */
  R.os.showPane('revenue');
  ok('forecast pane refuses to publish a forecast without data',
    /Enter your numbers|No forecast/.test(txt('#fcStatement')), txt('#fcStatement').slice(0, 70));
  ok('attribution graph states it has no data', /No attribution data/i.test(doc.querySelector('#attrSvg').textContent));

  /* what-if applies into the model */
  const wiVol = doc.querySelector('#wiVol');
  if (wiVol) {
    wiVol.value = '800';
    wiVol.dispatchEvent(new win.Event('input', { bubbles: true }));
    click(doc.querySelector('#wiApply'));
    ok('what-if applies to the pipeline model', R.calc.model().prospects === 800,
      String(R.calc.model().prospects));
    R.calc.clear();
  }

  /* ════ 7. metadata + assets ════ */
  const canonical = doc.querySelector('link[rel="canonical"]');
  ok('canonical uses the configured domain', canonical && canonical.href.indexOf(cfg.site.url.replace('https://', '')) > -1);
  ok('hreflang covers every configured locale',
    doc.querySelectorAll('link[rel="alternate"][hreflang]').length === cfg.site.locales.length + 1,
    doc.querySelectorAll('link[rel="alternate"][hreflang]').length + ' alternates');
  ok('manifest linked', !!doc.querySelector('link[rel="manifest"]'));
  ok('apple touch icon linked', !!doc.querySelector('link[rel="apple-touch-icon"]'));
  ok('og image declared from config', (doc.querySelector('meta[property="og:image"]') || {}).content
    .indexOf(cfg.seo.ogImage) > -1);
  ok('twitter card present', !!doc.querySelector('meta[name="twitter:card"]'));
  ok('structured data parses', (() => {
    try { return !!JSON.parse(doc.querySelector('script[type="application/ld+json"]').textContent); }
    catch (e) { return false; }
  })());
  const ld = JSON.parse(doc.querySelector('script[type="application/ld+json"]').textContent);
  const types = ld['@graph'].map(n => n['@type']);
  ok('structured data carries the core types',
    types.indexOf('Organization') > -1 && types.indexOf('SoftwareApplication') > -1 && types.indexOf('FAQPage') > -1,
    types.join(', '));
  const faqNode = ld['@graph'].filter(n => n['@type'] === 'FAQPage')[0];
  ok('FAQ structured data matches the configured entries', faqNode.mainEntity.length === cfg.faq.length);
  ok('title is a sensible length', cfg.seo.title.length <= 65, cfg.seo.title.length + ' chars');
  ok('description is a sensible length', cfg.site.description.length <= 165, cfg.site.description.length + ' chars');

  ok('no runtime errors after full interaction', errors.length === 0, errors.slice(0, 3).join(' | '));

  console.log(results.join('\n'));
  const failed = results.filter(r => r.startsWith('FAIL')).length;
  console.log('\n' + (results.length - failed) + '/' + results.length + ' checks passed');
  process.exit(failed ? 1 : 0);
}, 900);
