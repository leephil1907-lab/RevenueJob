/* ============================================================
   REVENUEPILOT — PIPELINE ENGINE (interactive, no sample data)
   ------------------------------------------------------------
   This replaces the simulated "live console" that used to ship invented
   prospects, invented revenue and invented agent traces. Nothing here is
   generated: every number on screen is either (a) typed by the visitor,
   (b) derived from what they typed with visible arithmetic, or (c) a product
   fact read from site.config.json.

   The formula is deliberately simple and shown in the UI, because a revenue
   projection nobody can audit is worse than no projection.

     qualified      = prospects      × qualification rate
     conversations  = qualified      × conversation rate
     meetings       = conversations  × meeting rate
     deals          = meetings       × close rate
     expected       = deals          × deal size
     pipeline       = deals          × deal size ÷ close rate   (weighted view)
   ============================================================ */
(function () {
  'use strict';

  const cfg = window.RP.cfg || {};
  const FIELDS = {
    prospects: { key: 'prospects', def: null, min: 0, max: 100000, step: 50, money: false },
    qual: { key: 'qual', def: null, min: 0, max: 100, step: 1, money: false, pct: true },
    conv: { key: 'conv', def: null, min: 0, max: 100, step: 1, money: false, pct: true },
    meet: { key: 'meet', def: null, min: 0, max: 100, step: 1, money: false, pct: true },
    close: { key: 'close', def: null, min: 0, max: 100, step: 1, money: false, pct: true },
    deal: { key: 'deal', def: null, min: 0, max: 1000000, step: 500, money: true }
  };
  const EXAMPLE = { prospects: 500, qual: 20, conv: 50, meet: 40, close: 25, deal: 8000 };

  const state = { prospects: null, qual: null, conv: null, meet: null, close: null, deal: null };
  const listeners = [];

  /* ---------- the model ---------- */
  function compute(s) {
    const P = Number(s.prospects) || 0;
    const q = (Number(s.qual) || 0) / 100;
    const c = (Number(s.conv) || 0) / 100;
    const m = (Number(s.meet) || 0) / 100;
    const k = (Number(s.close) || 0) / 100;
    const D = Number(s.deal) || 0;

    const qualified = P * q;
    const conversations = qualified * c;
    const meetings = conversations * m;
    const deals = meetings * k;
    const expected = deals * D;
    const pipeline = k > 0 ? expected / k : 0;
    return {
      prospects: P, qualified, conversations, meetings, deals, expected, pipeline,
      hasInput: s.prospects !== null && s.deal !== null,
      isEmpty: s.prospects === null && s.qual === null && s.conv === null &&
               s.meet === null && s.close === null && s.deal === null
    };
  }

  let last = compute(state);
  function emit() {
    last = compute(state);
    listeners.forEach(fn => { try { fn(last, state); } catch (e) { } });
  }

  /* ---------- DOM wiring ---------- */
  function readInputs(root) {
    Object.keys(FIELDS).forEach(k => {
      const el = root.querySelector('[data-calc="' + k + '"]');
      if (!el) return;
      const raw = el.value.trim();
      state[k] = raw === '' ? null : Math.max(0, Number(raw.replace(/[^0-9.]/g, '')) || 0);
    });
  }

  function paintFields(root) {
    Object.keys(FIELDS).forEach(k => {
      const el = root.querySelector('[data-calc="' + k + '"]');
      if (!el) return;
      const v = state[k];
      const next = v === null ? '' : String(v);
      if (el.value !== next) el.value = next;
      el.classList.toggle('is-empty', v === null);
    });
    /* range sliders mirror their number inputs where both exist */
    root.querySelectorAll('[data-calc-range]').forEach(r => {
      const k = r.getAttribute('data-calc-range');
      const v = state[k];
      r.value = v === null ? FIELDS[k].def || 0 : v;
    });
  }

  function render(root) {
    /* compute from the current state rather than a cached snapshot: rendering a
       stale model made every field lag one keystroke behind what was typed. */
    const m = compute(state);
    const set = (sel, text) => {
      const el = root.querySelector(sel);
      if (el) el.textContent = text;
    };
    const num = window.RP.num, money = window.RP.money;

    /* the chain, each step shown with the arithmetic that produced it */
    set('[data-out="prospects"]', state.prospects === null ? '—' : num(m.prospects));
    set('[data-out="qualified"]', state.qual === null || state.prospects === null ? '—' : num(m.qualified, { decimals: m.qualified < 10 && m.qualified % 1 !== 0 ? 1 : 0 }));
    set('[data-out="conversations"]', state.conv === null ? '—' : num(m.conversations, { decimals: m.conversations < 10 && m.conversations % 1 !== 0 ? 1 : 0 }));
    set('[data-out="meetings"]', state.meet === null ? '—' : num(m.meetings, { decimals: m.meetings < 10 && m.meetings % 1 !== 0 ? 1 : 0 }));
    set('[data-out="deals"]', state.close === null ? '—' : num(m.deals, { decimals: m.deals < 10 && m.deals % 1 !== 0 ? 2 : 1 }));
    set('[data-out="expected"]', state.deal === null || state.close === null ? '—' : money(m.expected));
    set('[data-out="pipeline"]', state.deal === null || state.close === null ? '—' : money(m.pipeline));
    set('[data-out="perDeal"]', state.deal === null ? '—' : money(Number(state.deal) || 0));

    /* the story the numbers tell, in words */
    const note = root.querySelector('[data-out="note"]');
    if (note) {
      if (m.isEmpty) {
        note.textContent = window.RP.t('calc.empty');
        note.parentElement.dataset.state = 'empty';
      } else if (!m.hasInput) {
        note.textContent = window.RP.t('calc.partial');
        note.parentElement.dataset.state = 'partial';
      } else {
        note.textContent = window.RP.t('calc.result')
          .replace('{qualified}', num(m.qualified)).replace('{deals}', num(m.deals, { decimals: 1 }))
          .replace('{revenue}', money(m.expected));
        note.parentElement.dataset.state = 'ready';
      }
    }

    /* width bars on the chain: proportional, so the funnel shape is visible */
    const maxv = Math.max(m.prospects, 1);
    ['prospects', 'qualified', 'conversations', 'meetings', 'deals'].forEach(k => {
      const bar = root.querySelector('[data-bar="' + k + '"]');
      if (!bar) return;
      const v = m[k] || 0;
      bar.style.setProperty('--w', Math.min(100, (v / maxv) * 100) + '%');
    });

    /* anything on the page that mirrors the model (story section, OS panes) */
    document.querySelectorAll('[data-mirror="expected"]').forEach(el => {
      el.textContent = m.hasInput ? money(m.expected) : '—';
    });
    document.querySelectorAll('[data-mirror="pipeline"]').forEach(el => {
      el.textContent = m.hasInput ? money(m.pipeline) : '—';
    });
    document.querySelectorAll('[data-mirror="deals"]').forEach(el => {
      el.textContent = m.hasInput ? num(m.deals, { decimals: 1 }) : '—';
    });
    document.querySelectorAll('[data-mirror="meetings"]').forEach(el => {
      el.textContent = state.meet === null ? '—' : num(m.meetings);
    });
  }

  function init() {
    const root = document.querySelector('[data-calc-root]');
    if (!root) return;

    readInputs(root);
    paintFields(root);
    render(root);

    root.addEventListener('input', e => {
      if (!e.target.closest('[data-calc]') && !e.target.closest('[data-calc-range]')) return;
      const rangeKey = e.target.getAttribute('data-calc-range');
      if (rangeKey) {
        const text = root.querySelector('[data-calc="' + rangeKey + '"]');
        if (text) text.value = e.target.value;
      }
      readInputs(root);
      paintFields(root);
      render(root);
      emit();
    });
    root.addEventListener('change', () => { readInputs(root); paintFields(root); render(root); emit(); });

    /* example values are opt-in and labelled as an example — the page ships empty */
    const ex = root.querySelector('[data-calc-example]');
    if (ex) ex.addEventListener('click', e => {
      e.preventDefault();
      Object.assign(state, EXAMPLE);
      paintFields(root); render(root); emit();
      ex.setAttribute('aria-pressed', 'true');
      const clear = root.querySelector('[data-calc-clear]');
      if (clear) clear.removeAttribute('aria-pressed');
    });
    const cl = root.querySelector('[data-calc-clear]');
    if (cl) cl.addEventListener('click', e => {
      e.preventDefault();
      Object.keys(state).forEach(k => { state[k] = null; });
      paintFields(root); render(root); emit();
      cl.setAttribute('aria-pressed', 'true');
      if (ex) ex.removeAttribute('aria-pressed');
    });

    window.RP.calc = {
      state: state,
      model: () => last,
      on: fn => { listeners.push(fn); return () => { const i = listeners.indexOf(fn); if (i > -1) listeners.splice(i, 1); }; },
      set: (patch) => { Object.assign(state, patch); paintFields(root); render(root); emit(); },
      clear: () => { Object.keys(state).forEach(k => { state[k] = null; }); paintFields(root); render(root); emit(); }
    };

    /* re-render on locale change: currency and number formatting follow */
    window.RP.i18n.on(() => render(root));
  }

  /* surface the product facts the page is allowed to state */
  function productFacts() {
    const caps = cfg.capabilities || {};
    const out = {
      agents: (caps.agents || []).length,
      autonomy: (caps.autonomyLevels || []).length,
      permissions: (caps.permissions || []).length,
      channels: (caps.channels || []).length,
      endpoints: ((caps.api || {}).endpoints || []).length,
      webhooks: ((caps.api || {}).webhooks || []).length,
      templates: (caps.templates || []).length,
      securityControls: (caps.security || []).length,
      locales: (cfg.site && cfg.site.locales || []).length
    };
    document.querySelectorAll('[data-fact]').forEach(el => {
      const k = el.getAttribute('data-fact');
      if (out[k] !== undefined) el.textContent = window.RP.num(out[k]);
    });
    /* the agent roster, rendered from config so it can never drift from the docs */
    const roster = document.querySelector('[data-agent-roster]');
    if (roster && caps.agents) {
      roster.innerHTML = caps.agents.map(a =>
        '<li class="roster-row">' +
        '<span class="roster-role">' + esc(a.role) + '</span>' +
        '<span class="roster-job">' + esc(a.job) + '</span>' +
        '<span class="roster-pol pill">' + esc(policyLabel(a.defaultAutonomy, caps)) + '</span>' +
        '</li>').join('');
    }
    const policyList = document.querySelector('[data-permission-list]');
    if (policyList && caps.permissions) {
      policyList.innerHTML = caps.permissions.map(p =>
        '<li class="perm-row"><span class="perm-action">' + esc(p.action) + '</span>' +
        '<span class="perm-pol">' + esc(p.policy) + '</span>' +
        '<span class="perm-note">' + esc(p.note) + '</span></li>').join('');
    }
  }
  function policyLabel(id, caps) {
    const lvl = (caps.autonomyLevels || []).filter(l => l.id === id)[0];
    return lvl ? lvl.label : id;
  }
  function esc(s) {
    return String(s === undefined ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  function boot() {
    init();
    productFacts();
    window.RP.i18n.on(productFacts);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
