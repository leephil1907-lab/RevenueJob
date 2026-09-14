/* ============================================================
   LAYER 5 — routes, console app, agent builder, signup flow
   The motion language continues past the marketing site.
   ============================================================ */
(function () {
  'use strict';
  const R = window.RP;
  const { $, $$, clamp, lerp, rnd, REDUCED, pad } = R;
  const S = window.RP.story;

  /* ---------- page transitions (no hard refresh, ever) ---------- */
  const ROUTES = {
    home: { view: '#view-home', title: 'RevenuePilot — Your AI revenue team. Always working.' },
    console: { view: '#view-console', title: 'Console · RevenuePilot OS' }
  };
  let current = 'home';

  function route(name, push) {
    if (!ROUTES[name] || name === current) return;
    const wipe = $('#wipe');
    const apply = () => {
      Object.keys(ROUTES).forEach(k => {
        const el = $(ROUTES[k].view);
        if (!el) return;
        const on = k === name;
        el.hidden = !on;
      });
      document.body.dataset.view = name;
      document.title = ROUTES[name].title;
      window.scrollTo({ top: 0, behavior: 'auto' });
      if (name === 'console') {
        S.fillTables();
        R.counters && R.counters.refresh();
        if (R.os) { R.os.showPane(R.os.state.pane || 'command'); R.os.paintMoney(); }
      } else if (R.counters) {
        R.counters.refresh();
      }
      current = name;
      // hash + history are best-effort: inside a sandboxed preview frame the origin is
      // opaque and history.replaceState throws SecurityError. Never let that break routing.
      try {
        if (push && history.replaceState) {
          history.replaceState(null, '', name === 'console' ? location.pathname + '#console-view' : location.pathname);
        } else if (name !== 'console' && location.hash === '#console-view') {
          location.hash = '';
        }
      } catch (err) { /* opaque origin — routing still works, URL just stays clean */ }
    };
    if (REDUCED || !wipe) { apply(); return; }
    wipe.classList.add('on');
    setTimeout(apply, 400);
    setTimeout(() => wipe.classList.remove('on'), 520);
  }

  function initRoutes() {
    $$('[data-route]').forEach(el => el.addEventListener('click', e => { e.preventDefault(); route(el.dataset.route, true); }));
    document.body.dataset.view = 'home';
  }

  /* ---------- console: pane routing lives in the OS layer (p17) ---------- */
  function initConsole() { /* replaced by RP.os.showPane — kept for call-order safety */ }

  /* ---------- sliders: paint the track fill ---------- */
  function initSliders() {
    $$('input[type=range]').forEach(inp => {
      const paint = () => {
        const p = ((inp.value - inp.min) / (inp.max - inp.min)) * 100;
        inp.style.setProperty('--p', p + '%');
      };
      paint();
      inp.addEventListener('input', paint);
    });
  }

  /* ---------- agent builder: the orb reacts to the visitor's own settings ----------
     The builder's numbers, labels and autonomy copy are owned by the OS layer
     (p17), which computes them from site.config.json and the visitor's inputs.
     This function only paints the decorative orb, so nothing is wired twice and
     no estimate is claimed in two places.
     ------------------------------------------------------------------ */
  function initBuilder() {
    const pers = $('#personality'), auto = $('#autonomy'), orb = $('#builderOrb');
    if (!pers || !auto || !orb) return;
    const core = $('.orb-core', orb);
    const role = $('#builderRole');

    function paint() {
      const p = parseInt(pers.value, 10) || 0;
      const a = parseInt(auto.value, 10) || 0;
      orb.classList.toggle('auto', a >= 60);
      orb.classList.toggle('review', a < 60);
      if (core) {
        const hue = lerp(-18, 26, p / 100);
        const sat = lerp(.85, 1.25, p / 100);
        core.style.filter = 'hue-rotate(' + hue.toFixed(0) + 'deg) saturate(' + sat.toFixed(2) + ')';
        core.style.transform = 'scale(' + (1 + (a / 100) * .05).toFixed(3) + ')';
      }
      if (role) role.textContent = p >= 67 ? 'AI Revenue Specialist · warm operator' : 'AI Revenue Specialist';
    }
    pers.addEventListener('input', paint);
    auto.addEventListener('input', paint);

    /* the console autonomy slider mirrors the builder: set the value, then let
       the OS layer repaint from its own rules */
    const ca = $('#consoleAutonomy');
    if (ca) ca.addEventListener('input', () => {
      auto.value = ca.value;
      auto.dispatchEvent(new Event('input', { bubbles: true }));
      paint();
    });
    paint();
  }

  /* ---------- signup: five questions, one continuous flow ---------- */
  const SELLS = [
    { t: 'Software / SaaS', d: 'Platform, seats or usage-based' },
    { t: 'Services / agency', d: 'Retainers, projects, fractional' },
    { t: 'Infrastructure / hardware', d: 'Long cycles, technical buying' },
    { t: 'Financial products', d: 'Fintech, lending, insurance' }
  ];
  const REACH = [
    { t: 'VPs & Directors', d: 'Mid-market · 200–2,000 seats' },
    { t: 'Founders & owners', d: 'SMB · fast cycles' },
    { t: 'C-suite', d: 'Enterprise · multi-thread' },
    { t: 'Technical buyers', d: 'Eng leads, devtools, platform' }
  ];
  const GOALS = [
    { t: 'More qualified meetings', d: 'Fill the top of the funnel' },
    { t: 'Pipeline coverage', d: 'Guarantee next quarter' },
    { t: 'Reactivate dormant accounts', d: 'Mine the database first' },
    { t: 'Enter a new market', d: 'Test a segment fast' }
  ];

  function initSignup() {
    const sheet = $('#signup');
    if (!sheet) return;
    const slides = $$('.su-slide');
    const bar = $('#suBar'), count = $('#suCount'), back = $('#suBack'), next = $('#suNext');
    const company = $('#suCompany'), note = $('#suCompanyNote');
    const rows = $$('.su-row');
    const log = $('#suLog');
    let step = 0, dir = 1;
    const state = { company: '', sells: '', reach: '', goal: '' };

    function options(hostId, list, key, twoCol) {
      const host = $(hostId);
      if (!host) return;
      host.innerHTML = list.map((o, i) =>
        '<button class="opt" data-key="' + key + '" data-val="' + o.t.replace(/"/g, '&quot;') + '">' +
        '<span class="k">' + pad(i + 1) + '</span>' +
        '<span style="min-width:0"><span style="display:block">' + o.t + '</span><span class="d" style="display:block">' + o.d + '</span></span>' +
        '<svg class="ck" viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg>' +
        '</button>').join('');
      void twoCol;
    }
    options('#suSells', SELLS, 'sells');
    options('#suReach', REACH, 'reach', true);
    options('#suGoal', GOALS, 'goal');

    $$('.opt[data-key]').forEach(opt => {
      opt.addEventListener('click', () => {
        const key = opt.dataset.key;
        state[key] = opt.dataset.val;
        $$('.opt[data-key="' + key + '"]').forEach(o => o.classList.toggle('on', o === opt));
        paintRows();
        if (key !== 'company') setTimeout(() => { if (step < 4) go(step + 1); }, 260);
      });
    });

    if (company) {
      company.addEventListener('input', () => {
        state.company = company.value.trim();
        paintRows();
        if (note) {
          note.textContent = state.company
            ? 'Domain detected · 240 employees · ' + (state.sells || 'fintech')
            : 'We use it to scope the agent and tune its voice.';
        }
      });
      company.addEventListener('keydown', e => { if (e.key === 'Enter' && step < 4) go(step + 1); });
    }

    function paintRows() {
      const set = (i, val) => {
        const r = rows[i];
        if (!r) return;
        const b = $('b', r);
        if (b && val) b.textContent = val;
        r.classList.toggle('on', !!val);
      };
      set(0, state.company);
      set(1, state.sells);
      set(2, state.reach);
      set(3, state.goal);
      set(4, step >= 4 ? ((name && name.value.trim()) || 'Your agent') + ' · AI Revenue Specialist' : '');
    }

    function render() {
      slides.forEach((s, i) => {
        const on = i === step;
        s.classList.toggle('on', on);
        s.classList.toggle('back', i < step);
      });
      // once deployed, the wizard's own nav row retires — the success slide owns the next action
      const nav = $('.su-nav', sheet);
      if (nav) nav.style.visibility = step >= 5 ? 'hidden' : 'visible';
      if (bar) bar.style.width = ((step + 1) / 6 * 100).toFixed(1) + '%';
      if (count) count.textContent = pad(Math.min(step + 1, 5)) + ' / 05';
      if (back) back.style.visibility = step > 0 ? 'visible' : 'hidden';
      if (next) {
        next.innerHTML = step >= 4 ? 'Deploy agent <span class="ar">→</span>' : 'Continue <span class="ar">→</span>';
      }
      const hint = $('#suStepHint');
      if (hint) hint.textContent = step >= 4 ? 'NO CARD REQUIRED' : 'PRESS ENTER';
      paintRows();
      if (step === 5 && log && !log.dataset.done) {
        log.dataset.done = '1';
        const lines = [
          ['init', 'agent container provisioned', 'ok'],
          ['crm', 'Salesforce connected · 2 objects', 'ok'],
          ['signals', '40 intent channels subscribed', ''],
          ['queue', '240 accounts loaded for research', ''],
          ['ready', 'first qualified accounts due in 72h', 'ok']
        ];
        lines.forEach((l, i) => {
          setTimeout(() => {
            const el = document.createElement('div');
            el.className = 'logline';
            el.innerHTML = '<span class="tt">' + pad(i) + '</span><span><b>' + l[0] + '</b> · ' + l[1] + (l[2] ? ' <i>' + l[2] + '</i>' : '') + '</span>';
            log.appendChild(el);
          }, REDUCED ? 0 : 420 + i * 460);
        });
      }
    }

    function go(n) {
      n = clamp(n, 0, 5);
      if (n === step) return;
      dir = n > step ? 1 : -1;
      step = n;
      render();
    }
    function open(el) {
      markOpener(el || document.activeElement);
      sheet.hidden = false;
      document.body.classList.add('locked');
      requestAnimationFrame(() => sheet.classList.add('on'));
      setTimeout(() => { if (company && step === 0) company.focus(); }, REDUCED ? 0 : 520);
    }
    let opener = null;
    function close() {
      sheet.classList.remove('on');
      document.body.classList.remove('locked');
      setTimeout(() => { sheet.hidden = true; }, 480);
      if (opener && opener.focus) { try { opener.focus(); } catch (e) { } }
    }
    function markOpener(el) { opener = el; }

    $$('[data-open-signup]').forEach(b => b.addEventListener('click', e => {
      // prefill from whatever the visitor configured in the builder
      const n = $('#agentNameInput');
      if (n && n.value.trim() && $('#suAgentName')) $('#suAgentName').textContent = n.value.trim();
      open(e.currentTarget);
    }));
    $$('[data-close-signup]').forEach(b => b.addEventListener('click', close));
    if (next) next.addEventListener('click', () => { if (step < 4) go(step + 1); else go(5); });
    if (back) back.addEventListener('click', () => go(step - 1));
    document.addEventListener('keydown', e => {
      if (sheet.hidden) return;
      if (e.key === 'Escape') close();
      if (e.key === 'Enter' && step < 5) {
        const t = e.target;
        if (t && t.tagName === 'INPUT') return;   // handled by the field
        if (step < 4) go(step + 1); else go(5);
        e.preventDefault();
      }
    });
    document.addEventListener('click', e => {
      const r = e.target.closest('[data-route]');
      if (r && !sheet.hidden) close();
    });
    window.RP.signupGo = go;
    render();
  }

  /* ---------- fixups: keep the static experience honest without JS ---------- */
  function injectFixups() {
    const st = document.createElement('style');
    st.textContent = '[hidden]{display:none !important}' +
      'html.no-js [data-reveal],html.no-js .cine .line-in{opacity:1;transform:none;filter:none;clip-path:none}' +
      '.mini-chat.live .mc{}' +
      '@media (prefers-reduced-motion:reduce){.story-track{height:auto}}';
    document.head.appendChild(st);
  }

  /* ---------- boot everything ---------- */
  function init() {
    injectFixups();
    S.fillTables();
    R.initNav();
    R.initParticles();
    R.initAtmo();
    R.interact.initCursor();
    R.interact.initMagnet();
    R.interact.initTilt();
    R.interact.initKinetic();
    R.interact.initHero();
    R.interact.initMinis();
    R.interact.initPulses();
    S.initStory();
    S.initCore();
    R.counters = R.initCounters();
    R.preview = S.initPreview();
    S.preview = R.preview;
    S.initPricing();
    S.initQuotes();
    S.initFAQ();
    S.initParallax();
    initRoutes();
    initConsole();
    initSliders();
    initBuilder();
    initSignup();

    // the platform console (RevenuePilot OS)
    try { if (window.RP.os) RP.os.initOS(); }
    catch (e) { if (window.console) console.warn('OS init', e); }

    // the hero orb: lite renderer paints instantly, WebGL upgrades when idle
    try { if (window.OrbEngine) OrbEngine.init(); }
    catch (e) { if (window.console) console.warn('Orb init', e); }

    // deep link into the console
    if (location.hash === '#console-view') {
      setTimeout(() => route('console', false), 60);
    }

    R.boot(() => {
      R.revealNow();
      const hero = $('#heroTitle');
      if (hero) requestAnimationFrame(() => hero.classList.add('in'));
      const kin = $('#kinetic');
      void kin;
    });
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') init();
  else document.addEventListener('DOMContentLoaded', init);

  window.App = { route: route };
})();
