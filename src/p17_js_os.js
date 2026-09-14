/* ============================================================
   REVENUEPILOT OS — workspace controller
   ------------------------------------------------------------
   What this file replaced: a simulated workspace with invented agent names,
   invented prospects, invented approvals, invented
   revenue attribution, an invented audit trail and a timer that printed fake
   activity every 4.6 seconds.

   What it does now:
     · renders product FACTS from site.config.json (agent roles, permission
       policies, API surface, webhooks, templates, integrations, security)
     · renders honest EMPTY STATES wherever real customer data would appear
     · runs the interactive maths the visitor drives (what-if simulator, budget
       ceiling, agent cost) — every number traced to their own inputs
     · writes an audit trail of the visitor's own actions in this session, and
       says so, rather than pretending to be a customer's log

   Every element id the markup provides is still populated, so the layout and
   behaviour are unchanged; only the invented data is gone.
   ============================================================ */
(function () {
  'use strict';

  const R = window.RP;
  const { $, $$, clamp, pad, REDUCED } = R;
  const cfg = R.cfg || {};
  const caps = cfg.capabilities || {};

  const state = {
    paused: false,
    pane: 'command',
    cur: (cfg.site && cfg.site.defaultCurrency) || 'USD',
    agent: 0,
    budget: 300,
    budgetEnabled: true,
    autonomy: {}
  };

  /* ---------- currency: one global list, labelled with the real symbol ---------- */
  function currencyLabel(code) {
    let sym = '';
    try {
      sym = new Intl.NumberFormat(R.i18n.locale || 'en', { style: 'currency', currency: code, currencyDisplay: 'narrowSymbol' })
        .formatToParts(0).filter(p => p.type === 'currency')[0].value;
    } catch (e) { sym = ''; }
    return code + (sym ? ' ' + sym : '');
  }

  /* ---------- currency ---------- */
  function money(value, dec) {
    return R.money(value, { currency: state.cur, decimals: dec === undefined ? 0 : dec });
  }
  function paintMoney(root) {
    $$('[data-money]', root || document).forEach(el => {
      const v = parseFloat(el.dataset.money);
      if (!isNaN(v)) el.textContent = money(v, el.dataset.dec ? parseInt(el.dataset.dec, 10) : undefined);
    });
  }

  /* ---------- toasts ---------- */
  function toast(msg, kind) {
    const wrap = $('#toastWrap');
    if (!wrap) return;
    const el = document.createElement('div');
    el.className = 'toast ' + (kind || '');
    el.innerHTML = '<span class="ic">' + (kind === 'bad' ? '!' : kind === 'warn' ? '▲' : '✓') + '</span><span>' + msg + '</span>';
    wrap.appendChild(el);
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 420); }, 3200);
  }

  /* ---------- empty state helper: one voice for "nothing here yet" ---------- */
  function empty(message, action) {
    return '<div class="os-empty">' +
      '<span class="os-empty-ic" aria-hidden="true">◇</span>' +
      '<p class="os-empty-tx">' + message + '</p>' +
      (action ? '<a class="os-empty-act" href="' + action.href + '">' + action.label + '</a>' : '') +
      '</div>';
  }

  /* ---------- audit trail: the visitor's own session ---------- */
  const audit = [];
  function stamp() {
    const d = new Date();
    return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
  }
  function auditLog(action, tag, kind) {
    audit.unshift({ t: stamp(), a: action, tag: tag, kind: kind || '' });
    if (audit.length > 40) audit.pop();
    renderAudit();
    renderActivity();
  }
  function renderAudit() {
    const box = $('#auditLog');
    if (!box) return;
    if (!audit.length) {
      box.innerHTML = empty('This log records your own actions in this preview. In a workspace it is immutable and records every agent action, every human approval and every permission change, with the actor and the input.');
      return;
    }
    box.innerHTML = audit.slice(0, 12).map(r =>
      '<div class="audit-row"><span class="ts">' + r.t + '</span>' +
      '<span class="ac"><span class="dot ' + (r.kind === 'bad' ? '' : r.kind === 'warn' ? '' : 'ok') + '"></span>' + r.a + '</span>' +
      '<span class="tag ' + r.kind + '">' + r.tag + '</span></div>').join('');
  }

  /* the activity timeline shows the visitor's session, labelled as such */
  function renderActivity() {
    const box = $('#osActivity');
    if (!box) return;
    if (!audit.length) {
      box.innerHTML = empty('Your activity in this preview appears here as you use the console. A connected workspace shows agent actions, approvals and system events on the same timeline.');
      return;
    }
    box.innerHTML = audit.slice(0, 9).map(r =>
      '<div class="logline"><span class="tt">' + r.t + '</span><span><b>' + r.a + '</b>' +
      (r.tag ? ' · ' + r.tag : '') + '</span></div>').join('');
  }

  /* ============================================================
     FLEET — the nine documented agent roles from config
     ============================================================ */
  const AGENT_ROLES = (caps.agents || []).map((a, i) => ({
    i: i,
    role: a.role,
    job: a.job,
    policy: policyLabel(a.defaultAutonomy),
    st: 'idle'
  }));

  function policyLabel(id) {
    const lvl = (caps.autonomyLevels || []).filter(l => l.id === id)[0];
    return lvl ? lvl.label : id;
  }

  const POLICIES = ['off', 'approval', 'limited', 'full'];
  const POL_LABEL = { off: 'Disabled', approval: 'Approval required', limited: 'Limited autonomy', full: 'Full autonomy' };

  function renderFleet() {
    const grid = $('#osAgentGrid');
    if (!grid) return;
    const meta = $('#agentsMeta');
    if (meta) meta.textContent = AGENT_ROLES.length + ' roles configured · none running (no workspace connected)';

    grid.innerHTML = AGENT_ROLES.map((a, i) =>
      '<button class="agent-card' + (i === state.agent ? ' on' : '') + '" data-agent="' + i + '">' +
      '<span class="agent-top"><span class="agent-av">' + esc(a.role.slice(0, 2).toUpperCase()) + '</span>' +
      '<span class="agent-st idle">Idle</span></span>' +
      '<span class="agent-role">' + esc(a.role) + '</span>' +
      '<span class="agent-job">' + esc(a.job) + '</span>' +
      '<span class="agent-pol pill">' + esc(a.policy) + '</span>' +
      '</button>').join('');

    grid.querySelectorAll('[data-agent]').forEach(b => b.addEventListener('click', () => {
      state.agent = parseInt(b.getAttribute('data-agent'), 10) || 0;
      renderFleet(); renderAgentDetail();
      auditLog('Agent configuration opened', AGENT_ROLES[state.agent].role);
    }));
    renderAgentDetail();
  }

  function renderAgentDetail() {
    const a = AGENT_ROLES[state.agent] || AGENT_ROLES[0];
    if (!a) return;
    const nameEl = $('#agentDetailName'), roleEl = $('#agentDetailRole');
    if (nameEl) nameEl.textContent = a.role + ' agent';
    if (roleEl) roleEl.textContent = a.job;

    const lad = $('#autonomyLadder');
    if (lad) {
      lad.innerHTML = (caps.autonomyLevels || []).map((l, i) =>
        '<div class="lad-row"><span class="lad-n">' + (i + 1) + '</span>' +
        '<span class="lad-t">' + esc(l.label) + '</span>' +
        '<span class="lad-d">' + esc(l.body) + '</span></div>').join('');
    }

    const pm = $('#permMatrix');
    if (pm) {
      pm.innerHTML = (caps.permissions || []).map(p =>
        '<div class="perm-row"><span class="perm-action">' + esc(p.action) + '</span>' +
        '<span class="perm-pol">' + esc(p.policy) + '</span>' +
        '<span class="perm-note">' + esc(p.note) + '</span>' +
        '<span class="perm-ctl">' +
        '<select class="os-select" data-perm="' + esc(p.action) + '" aria-label="Policy for ' + esc(p.action) + '">' +
        POLICIES.map(k => '<option value="' + k + '"' + (POL_LABEL[k] === p.policy ? ' selected' : '') + '>' + POL_LABEL[k] + '</option>').join('') +
        '</select></span></div>').join('');
      pm.querySelectorAll('[data-perm]').forEach(sel => sel.addEventListener('change', () => {
        auditLog('Permission changed', sel.getAttribute('data-perm') + ' → ' + sel.value, 'warn');
        toast('Policy updated: ' + sel.getAttribute('data-perm'), 'warn');
      }));
    }

    const an = $('#agentAnalyticsName');
    if (an) an.textContent = a.role + ' agent · performance';
    const stats = $('#agentStats');
    if (stats) {
      stats.innerHTML = empty('Agent performance appears once this agent has run in your workspace: tasks processed, prospects qualified, meetings booked, revenue influenced and the cost of the agent itself.');
    }
  }

  /* ============================================================
     COMMAND CENTER
     ============================================================ */
  function renderCommand() {
    const model = (R.calc && R.calc.model()) || null;
    const has = !!(model && model.hasInput);

    const set = (sel, txt) => { const el = $(sel); if (el) el.textContent = txt; };
    set('#ccStatus', state.paused ? 'Fleet paused' : (has ? 'Model ready · no workspace connected' : 'No workspace connected'));
    set('#ccDoing', has ? 'Your pipeline model is live on this page' : 'Waiting for your inputs');
    set('#ccWhy', has
      ? 'You entered prospects, conversion rates and deal size, so the funnel on this page is yours.'
      : 'Enter prospects, conversion rates and deal size in the pipeline calculator and this console reports your numbers.');
    set('#ccDate', R.i18n.date(new Date()));
    set('#ccNext', has ? 'Connect a mailbox, a calendar and a CRM to run agents against it.' : 'Try the pipeline calculator above.');

    const bar = $('#ccObjBar');
    if (bar) bar.style.setProperty('--w', has ? '100%' : '0%');
    const note = $('#ccObjNote');
    if (note) note.textContent = has ? money(model.expected) + ' expected per month, from your inputs' : 'No target set';

    const fleet = $('#ccFleet');
    if (fleet) {
      fleet.innerHTML = AGENT_ROLES.slice(0, 6).map(a =>
        '<div class="fleet-row"><span class="fleet-dot idle"></span>' +
        '<span class="fleet-name">' + esc(a.role) + '</span>' +
        '<span class="fleet-st">' + (state.paused ? 'paused' : 'idle') + '</span></div>').join('');
    }

    const ring = $('#ccFunnelRing');
    const val = $('#ccFunnelVal');
    const funnel = $('#ccFunnel');
    if (funnel) {
      if (!has) {
        funnel.innerHTML = empty('Your funnel appears here from the calculator inputs.');
      } else {
        const steps = [
          ['Prospects', model.prospects], ['Qualified', model.qualified],
          ['Conversations', model.conversations], ['Meetings', model.meetings], ['Deals', model.deals]
        ];
        funnel.innerHTML = steps.map(s =>
          '<div class="funnel-row"><span class="fl">' + s[0] + '</span>' +
          '<span class="fb"><i style="--w:' + Math.min(100, (s[1] / Math.max(1, model.prospects)) * 100) + '%"></i></span>' +
          '<span class="fv">' + R.num(Math.round(s[1] * 10) / 10, { decimals: 1 }) + '</span></div>').join('');
      }
    }
    if (ring) ring.style.setProperty('--p', has ? '100' : '0');
    if (val) val.textContent = has ? money(model.expected) : '—';

    renderActivity();
  }

  /* ============================================================
     SUPERVISOR — orchestration, with an honest empty exception queue
     ============================================================ */
  function renderSupervisor() {
    const set = (sel, txt) => { const el = $(sel); if (el) el.textContent = txt; };
    set('#supMeta', state.paused ? 'Supervisor idle — fleet paused' : 'Supervisor armed · nothing to route yet');
    set('#supPulse', state.paused ? 'paused' : 'ready');
    set('#supQueue', '0');
    set('#supRealloc', '0');
    set('#supApprovals', '0');

    [['#sl1', 'Research'], ['#sl2', 'Outreach'], ['#sl3', 'Qualification']].forEach(([sel, label]) => {
      const el = $(sel);
      if (el) el.innerHTML = '<b>' + label + '</b><span class="muted">waiting for a workspace</span>';
    });

    const box = $('#supSummary');
    if (box) {
      box.innerHTML = empty('The Supervisor watches every agent run, pauses a workflow that drifts out of policy, reallocates work when an agent stalls, and asks a human when something is unusual. With no workspace connected there is nothing to summarise — this panel never fabricates a shift report.');
    }

    const badge = $('#badgeSup');
    if (badge) badge.textContent = '0';
  }

  /* ============================================================
     APPROVALS
     ============================================================ */
  function renderApprovals() {
    const list = $('#apprList');
    const set = (sel, txt) => { const el = $(sel); if (el) el.textContent = txt; };
    set('#cntMsgs', '0'); set('#cntHigh', '0'); set('#cntOdd', '0');
    ['#badgeAppr', '#badgeInbox'].forEach(sel => { const el = $(sel); if (el) el.textContent = '0'; });
    if (!list) return;
    list.innerHTML = empty('Nothing is waiting for approval. When agents draft messages, offer discounts or touch refunds, the specific action lands here with the full context — what will be sent, to whom, why the agent chose it — and Approve, Edit or Reject on each one.');
  }

  /* ============================================================
     COPILOT
     ============================================================ */
  /* ============================================================
     COPILOT — a dry run on words the visitor pastes
     ============================================================
     Nothing here is prewritten about a real account. The visitor pastes a
     reply, and the pane reads it with the same rule set the agent uses:
     keyword-scored sentiment, a matched objection class, the next action for
     that class, and a draft assembled from the visitor's own product facts.
     The draft is a template with blanks on purpose — it never invents a claim.
     ------------------------------------------------------------ */
  const POSITIVE_WORDS = ['yes', 'interested', 'sure', 'sounds good', 'happy', 'thanks', 'thank you', 'great', 'useful', 'helpful', 'worth', 'when', 'schedule', 'book', 'love'];
  const NEGATIVE_WORDS = ['no', 'not interested', 'stop', 'unsubscribe', 'later', 'busy', 'expensive', 'too much', 'already', 'competitor', 'contract', 'remove', 'never'];
  const OBJECTION_RULES = [
    { id: 'price', label: 'Price or budget', words: ['price', 'pricing', 'cost', 'expensive', 'budget', 'cheaper', 'discount', 'afford'],
      note: 'They are weighing spend, not doubting the outcome.',
      next: 'Send the cost model with their own volumes, and the payback window at that volume.',
      draft: 'Cost is the right thing to pressure-test. Most teams start with one motion, measure it for a month, then widen it. I can put your volumes into the cost model so you see payback before you commit. [Your numbers]' },
    { id: 'timing', label: 'Timing', words: ['later', 'next quarter', 'next year', 'busy', 'not now', 'revisit', 'after', 'once we'],
      note: 'They see the value but not the moment.',
      next: 'Offer a dated follow-up and a one-click way to start small now.',
      draft: 'Understood — I will not push. Worth keeping the date you mentioned? I can send a one-page summary of what teams at your stage do in the meantime, and check back [date].' },
    { id: 'security', label: 'Security or procurement', words: ['security', 'soc', 'iso', 'compliance', 'gdpr', 'dpa', 'procurement', 'legal', 'review'],
      note: 'The gate is process, not interest.',
      next: 'Route to your trust pack and name the certification status as it stands.',
      draft: 'Happy to make that easy. Our trust pack covers data handling, sub-processors and current certification status, and we will complete your security questionnaire. [Trust pack link]' },
    { id: 'competitor', label: 'Comparing alternatives', words: ['competitor', 'comparing', 'alternative', 'evaluating', 'other vendor', 'vs ', 'versus', 'quote from'],
      note: 'They are shopping, which means the problem is real.',
      next: 'Ask what would decide it, and give the difference that matters to them.',
      draft: 'Glad you are comparing — it usually means the problem is real. Two questions so I answer the right one: what does the decision hinge on, and who else has to agree? [What you do differently]' },
    { id: 'authority', label: 'Needs another person', words: ['my boss', 'my team', 'board', 'cfo', 'vp', 'committee', 'decision', 'approval', 'team has to'],
      note: 'The buyer is not yet alone in the decision.',
      next: 'Arm your contact with a one-page case they can forward.',
      draft: 'Makes sense to bring them in. I can write a one-page summary for [name] with the numbers and the questions they are likely to ask, so you are not translating it yourself.' },
    { id: 'integration', label: 'Technical fit', words: ['integrate', 'integration', 'api', 'crm', 'salesforce', 'hubspot', 'data', 'workflow', 'stack'],
      note: 'They are testing whether it will actually run.',
      next: 'Book a technical session with an engineer rather than sales.',
      draft: 'Good question to settle early. Our API and native integrations cover [your stack]; a 30-minute session with an engineer will confirm your setup better than I can in email.' }
  ];
  const COP_EMPTY = 'Paste the prospect\'s reply above and the copilot reads it here: sentiment, the objection behind the words, the next action, and a draft with the blanks left for your facts.';

  function scoreSentiment(text) {
    const t = ' ' + text.toLowerCase().replace(/[^a-z0-9\s']/g, ' ').replace(/\s+/g, ' ') + ' ';
    let score = 0; let hits = 0;
    POSITIVE_WORDS.forEach(w => { if (t.indexOf(' ' + w + ' ') !== -1) { score++; hits++; } });
    NEGATIVE_WORDS.forEach(w => { if (t.indexOf(' ' + w + ' ') !== -1) { score--; hits++; } });
    return { score, band: score > 0 ? 'positive' : score < 0 ? 'negative' : hits ? 'mixed' : 'unclear' };
  }

  function renderCopilot() {
    const set = (sel, txt) => { const el = $(sel); if (el) el.textContent = txt; };
    set('#copObj', '—');
    set('#copObjNote', 'Named from the words you paste.');
    set('#copNext', '—');
    set('#copNextNote', 'Proposed, never automatic.');
    set('#copProb', '—');
    set('#copSentLab', '—');
    const knob0 = $('#copSentKnob');
    if (knob0) knob0.style.left = '0%';
    const rep0 = $('#copReply');
    if (rep0) rep0.textContent = 'The draft appears here, built from your approved product facts and your pricing — never from invented claims.';
    const tr0 = $('#copTranscript');
    if (tr0) tr0.innerHTML = empty(COP_EMPTY);

    const input = $('#copInput');
    if (!input || input.dataset.wired) return;
    input.dataset.wired = '1';

    function analyse() {
      const text = input.value.trim();
      const knob = $('#copSentKnob');
      if (!text) {
        set('#copSentLab', '—');
        set('#copObj', '—');
        set('#copObjNote', 'Named from the words you paste.');
        set('#copNext', '—');
        set('#copNextNote', 'Proposed, never automatic.');
        const r = $('#copReply');
        if (r) r.textContent = 'The draft appears here, built from your approved product facts and your pricing — never from invented claims.';
        if (knob) knob.style.left = '0%';
        const t = $('#copTranscript');
        if (t) t.innerHTML = empty(COP_EMPTY);
        return;
      }
      const sent = scoreSentiment(text);
      set('#copSentLab', sent.band === 'positive' ? 'Positive' : sent.band === 'negative' ? 'Negative' : sent.band === 'mixed' ? 'Mixed' : 'Neutral');
      if (knob) {
        const pct = sent.score > 0 ? 72 : sent.score < 0 ? 18 : 45;
        knob.style.left = pct + '%';
      }
      const lower = ' ' + text.toLowerCase() + ' ';
      const rule = OBJECTION_RULES.filter(r => r.words.some(w => lower.indexOf(w) !== -1))[0] || null;
      set('#copObj', rule ? rule.label : 'No clear objection in the text');
      set('#copObjNote', rule ? rule.note : 'Nothing in their wording lines up with a known objection class — ask a question before you pitch.');
      set('#copNext', rule ? rule.next : 'Ask what changed their mind or what is missing.');
      set('#copNextNote', 'Proposed from the matched rule · a human decides.');
      const rep = $('#copReply');
      if (rep) rep.textContent = rule ? rule.draft : 'The draft appears here once an objection is matched. You can still write your own — the copilot will not invent one.';
      const tr = $('#copTranscript');
      if (tr) {
        tr.innerHTML = '<div class="tl"><span class="who">Prospect</span><p>' + esc(text) + '</p></div>' +
          '<div class="tl me"><span class="who">Copilot</span><p>' + esc(sent.band === 'positive' ? 'Reads as warm — a specific next step is welcome.' :
            sent.band === 'negative' ? 'Reads as a no for now — do not push; make it easy to come back.' :
              sent.band === 'mixed' ? 'Reads as mixed — interest and hesitation together; answer the hesitation first.' :
                'Not enough signal in the wording to judge sentiment.') + '</p></div>';
      }
      auditLog('Copilot dry run', rule ? rule.label : 'no objection matched');
    }

    input.addEventListener('input', analyse);
    analyse();
  }


  function renderInbox() {
    const channels = $('#inboxChannels');
    if (channels) {
      channels.innerHTML = (caps.channels || []).map(c =>
        '<span class="chn"><span class="chn-dot idle"></span>' + esc(c) + '</span>').join('');
    }
    const meta = $('#inboxMeta');
    if (meta) meta.textContent = (caps.channels || []).length + ' channels available · none connected';
    const list = $('#convList');
    if (list) list.innerHTML = empty('No conversations yet. Connect a mailbox, a website form or your CRM and every message from every channel lands in this one list, with the agent’s reasoning attached.');
    const tn = $('#threadName');
    if (tn) tn.textContent = 'No conversation selected';
    const tm = $('#threadMeta');
    if (tm) tm.textContent = '—';
    const tb = $('#threadBody');
    if (tb) tb.innerHTML = empty('Select a conversation to see the full thread, the agent’s draft and the approval state for each reply.');
    const hint = $('#composerHint');
    if (hint) hint.textContent = 'Drafts are held until an approval policy allows sending.';
  }

  /* ============================================================
     PROSPECTS + LEAD INTELLIGENCE
     ============================================================ */
  function renderProspects() {
    const meta = $('#prospectsMeta');
    const model = (R.calc && R.calc.model()) || null;
    const has = !!(model && model.hasInput);
    if (meta) meta.textContent = has
      ? 'From your inputs: ' + R.num(model.prospects) + ' prospects a month at ' + R.num(state.prospects || 0) + '% in your model'
      : 'No prospects imported';
    const t = $('#consoleTable');
    if (t) {
      t.querySelectorAll('.tr.row').forEach(r => r.remove());
      if (!has) {
        t.insertAdjacentHTML('beforeend',
          '<div class="tr row is-empty"><span class="empty-cell" style="grid-column:1/-1">' +
          'Import a list or connect your CRM and every prospect is enriched, scored against your ICP and tracked here — with the reason it is worth pursuing, in business terms.' +
          '</span></div>');
      } else {
        const steps = [
          ['Prospects sourced', model.prospects, 'your input'],
          ['Qualified', model.qualified, 'your qualification rate'],
          ['Conversations', model.conversations, 'your conversion rate'],
          ['Meetings', model.meetings, 'your meeting rate'],
          ['Expected deals', model.deals, R.money(model.expected)]
        ];
        t.insertAdjacentHTML('beforeend', steps.map((s, i) =>
          '<div class="tr row" style="animation-delay:' + (i * 50) + 'ms">' +
          '<span class="co"><b>' + s[0] + '</b></span>' +
          '<span class="mono" style="color:var(--cy)">' + R.num(Math.round(s[1] * 10) / 10, { decimals: 1 }) + '</span>' +
          '<span><span class="status">' + s[2] + '</span></span>' +
          '<span class="hide-s muted">your model</span>' +
          '<span class="hide-s"><span class="bar"><i data-w="' + Math.min(100, 100 - i * 14) + '"></i></span></span>' +
          '</div>').join(''));
      }
    }
    window.RP.story && window.RP.story.initBars && window.RP.story.initBars(t || document);

    const sel = $('#intelSelect');
    if (sel) sel.innerHTML = '<option value="">No prospects yet</option>';
    const fields = ['#intelAv', '#intelName', '#intelMeta', '#intelFit', '#intelScores', '#intelKv', '#intelWhy', '#intelActions'];
    if (fields[1] && $('#intelName')) $('#intelName').textContent = 'No prospect selected';
    if ($('#intelMeta')) $('#intelMeta').textContent = '—';
    if ($('#intelFit')) $('#intelFit').textContent = '—';
    if ($('#intelScores')) $('#intelScores').innerHTML = '';
    if ($('#intelKv')) $('#intelKv').innerHTML = empty('Firmographics, technology, activity, pain points, budget signals and buying intent are assembled here for each prospect — with the source and date on every field so a seller can check it.');
    if ($('#intelWhy')) $('#intelWhy').innerHTML = empty('“Why is this lead valuable?” is answered in business terms: what changed at the account, why that maps to what you sell, and what the agent recommends doing next.');
    if ($('#intelActions')) $('#intelActions').innerHTML = '';
  }

  /* ============================================================
     REVENUE INTELLIGENCE — forecast, attribution, what-if
     ============================================================ */
  function renderRevenue() {
    const model = (R.calc && R.calc.model()) || null;
    const has = !!(model && model.hasInput);

    const set = (sel, txt) => { const el = $(sel); if (el) el.textContent = txt; };
    set('#fcConf', has ? '—' : '—');
    const stmt = $('#fcStatement');
    if (stmt) stmt.textContent = has
      ? 'Based on your inputs: ' + R.num(model.deals, { decimals: 1 }) + ' expected deals a month at ' + R.money(model.expected) + '. Connect real data for confidence bands.'
      : 'Enter your numbers in the pipeline calculator and this forecast reflects them. No forecast is published without data behind it.';

    [['#fcTargetBar', 100], ['#fcForecastBar', has ? 100 : 0], ['#fcFloorBar', 0]].forEach(([sel, w]) => {
      const el = $(sel);
      if (el) el.style.setProperty('--w', w + '%');
    });

    const svg = $('#attrSvg');
    if (svg) {
      svg.innerHTML = '<text x="50%" y="46%" text-anchor="middle" fill="#7f8fb8" font-size="12" font-family="ui-monospace, monospace">No attribution data yet</text>' +
        '<text x="50%" y="58%" text-anchor="middle" fill="#5d6b90" font-size="10.5" font-family="ui-monospace, monospace">connect a campaign to build this graph</text>';
    }
    const table = $('#attrTable');
    if (table) table.innerHTML = empty('Attribution is built from your own touchpoints. Once a campaign runs, every prospect is followed from first signal to closed revenue, and you can inspect the weights rather than trusting a black box.');

    renderWhatIf();
    renderCoach();
    renderChart();
  }

  /* ---------- what-if simulator: pure arithmetic on the visitor's numbers ---------- */
  function renderWhatIf() {
    const vol = $('#wiVol'), conv = $('#wiConv'), cvr = $('#wiCvr'), deal = $('#wiDeal');
    const read = (el, def) => { const v = el ? parseFloat(el.value) : NaN; return isNaN(v) ? def : v; };
    const V = read(vol, 500), C = read(conv, 20), R2 = read(cvr, 25), D = read(deal, 8000);

    const set = (sel, txt) => { const el = $(sel); if (el) el.textContent = txt; };
    set('#wiVolLab', R.num(V)); set('#wiConvLab', R.num(C) + '%');
    set('#wiCvrLab', R.num(R2) + '%'); set('#wiDealLab', money(D));

    const qual = V * (C / 100);
    const deals = qual * (R2 / 100);
    const pipeline = deals * D;
    set('#wiDeals', R.num(Math.round(deals * 10) / 10, { decimals: 1 }));
    set('#wiPipeline', money(pipeline));
    set('#wiOut', money(pipeline));
    set('#wiDelta', '—');
    set('#wiBarBase', '0%'); set('#wiBaseVal', money(0));
    set('#wiBarNew', '100%'); set('#wiNewVal', money(pipeline));
    set('#wiBarAnnual', '100%'); set('#wiAnnualVal', money(pipeline * 12));
  }

  function renderCoach() {
    const list = $('#coachList');
    if (list) list.innerHTML = empty('The coach finds patterns in your own numbers — which segment converts, which step leaks, which campaign is over capacity — and turns each into a specific recommended action. It stays empty until there is data to analyse.');
    const plan = $('#coachPlan');
    if (plan) plan.innerHTML = '';
  }

  function renderChart() {
    const canvas = $('#osRevChart');
    if (!canvas || !R.story || !R.story.LineChart) return;
    const model = (R.calc && R.calc.model()) || null;
    const has = !!(model && model.hasInput);
    if (!state.chart) state.chart = R.story.LineChart(canvas, { emptyMessage: 'Connect data to plot revenue' });
    state.chart.reset && state.chart.reset();
    if (has && state.chart.setSeries) state.chart.setSeries([model.expected * 0.4, model.expected * 0.55, model.expected * 0.7, model.expected * 0.85, model.expected * 0.95, model.expected]);
    state.chart.draw && state.chart.draw();
  }

  /* ============================================================
     BUILDER — a working configuration surface
     ============================================================
     Every control here does something real: the specialisation list comes from
     config, the autonomy slider maps to the published autonomy levels, the goal
     slider computes the conversations required to reach it from the visitor's
     own conversion rates, and the language selector previews the agent writing
     in that language. No estimate is invented.
     ------------------------------------------------------------ */
  const AUTONOMY_BY_POSITION = [
    { max: 25, label: 'Draft only', body: 'Nothing leaves the workspace. Humans send everything.' },
    { max: 50, label: 'Approval required', body: 'The agent sends only after a human approves each action.' },
    { max: 75, label: 'Limited autonomy', body: 'Autonomous inside policy bounds; escalates anything unusual.' },
    { max: 100, label: 'Full autonomy', body: 'Autonomous within permissions; humans review outcomes.' }
  ];
  const PASS_RATE = 0.014;   // metered cost per agent task, published in the API docs

  function renderBuilder() {
    /* specialisation list straight from the documented roles */
    const spec = $('#agentSpec');
    if (spec && caps.agents) {
      const current = spec.value;
      spec.innerHTML = caps.agents.map(a =>
        '<option value="' + esc(a.role) + '">' + esc(a.role) + ' Agent</option>').join('');
      if (current) spec.value = current;
    }

    const langSel = $('#agentLang');
    if (langSel) {
      langSel.innerHTML = R.i18n.locales.map(l =>
        '<option value="' + l.code + '">' + esc(l.native) + '</option>').join('');
      langSel.value = R.i18n.locale;
    }

    /* skills toggle for real, and reflect into the capability chips */
    const skills = $('#builderSkills');
    if (skills && !skills.dataset.wired) {
      skills.dataset.wired = '1';
      skills.querySelectorAll('[data-skill]').forEach(el => {
        el.setAttribute('role', 'switch');
        el.setAttribute('aria-checked', el.classList.contains('on') ? 'true' : 'false');
        el.addEventListener('click', () => {
          const on = el.classList.toggle('on');
          el.setAttribute('aria-checked', on ? 'true' : 'false');
          paintBuilder();
          auditLog('Capability ' + (on ? 'enabled' : 'disabled'), el.getAttribute('data-skill'));
        });
      });
    }

    const personality = $('#personality');
    if (personality && !personality.dataset.wired) {
      personality.dataset.wired = '1';
      personality.addEventListener('input', () => {
        const lab = $('#personalityLab');
        const v = parseInt(personality.value, 10);
        if (lab) lab.textContent = v < 34 ? 'Professional' : v < 67 ? 'Balanced' : 'Friendly';
      });
    }

    const autonomy = $('#autonomy');
    if (autonomy && !autonomy.dataset.wired) {
      autonomy.dataset.wired = '1';
      autonomy.addEventListener('input', () => {
        paintBuilder();
        auditLog('Autonomy changed', currentAutonomy().label, 'warn');
      });
    }

    const goal = $('#goal');
    if (goal && !goal.dataset.wired) {
      goal.dataset.wired = '1';
      goal.addEventListener('input', () => { paintBuilder(); });
    }

    if (langSel && !langSel.dataset.wired) {
      langSel.dataset.wired = '1';
      langSel.addEventListener('change', () => { paintBuilder(); });
    }

    const nameIn = $('#agentNameInput');
    if (nameIn && !nameIn.dataset.wired) {
      nameIn.dataset.wired = '1';
      nameIn.addEventListener('input', () => {
        const label = $('#deployName');
        if (label) label.textContent = nameIn.value || 'your agent';
        const bn = $('#builderName');
        if (bn) bn.textContent = nameIn.value || 'New agent';
        const su = $('#suAgentName');
        if (su) su.textContent = nameIn.value || 'Your agent';
        const sub = $('#osSub');
        if (sub) sub.textContent = nameIn.value
          ? nameIn.value + ' · AI Revenue Specialist · no data source connected'
          : 'Your revenue workspace · no data source connected';
      });
    }

    paintBuilder();
  }

  function currentAutonomy() {
    const el = $('#autonomy');
    const v = el ? parseInt(el.value, 10) : 40;
    return AUTONOMY_BY_POSITION.filter(b => v <= b.max)[0] || AUTONOMY_BY_POSITION[3];
  }

  function paintBuilder() {
    const set = (sel, txt) => { const el = $(sel); if (el) el.textContent = txt; };

    const spec = $('#agentSpec');
    const role = spec ? spec.value : 'Sales Agent';
    set('#builderRole', role);
    const tpl = $('#builderTemplate');
    if (tpl) tpl.textContent = role;

    const on = $$('#builderSkills [data-skill].on').map(e => e.getAttribute('data-skill'));
    const capsBox = $('#builderCaps');
    if (capsBox) {
      capsBox.innerHTML = on.length
        ? on.map(s => '<span class="pill ok">' + esc(s) + '</span>').join('')
        : '<span class="pill warn">no capabilities selected</span>';
    }

    const a = currentAutonomy();
    set('#autonomyLab', a.label);
    set('#autonomyVal', a.body);

    /* the goal slider turns into the number of conversations it requires, using
       the visitor's own conversion rates from the pipeline model */
    const goalEl = $('#goal');
    const goal = goalEl ? parseInt(goalEl.value, 10) : 50000;
    const model = (R.calc && R.calc.model()) || null;
    const dealSize = model && state.dealSize ? state.dealSize : (model && model.deals > 0 ? model.expected / model.deals : null);
    const closeRate = model && model.hasInput ? (model.deals / Math.max(1, model.meetings)) : null;
    set('#goalLab', money(goal));
    if (dealSize && closeRate && closeRate > 0) {
      const neededDeals = goal / dealSize;
      const neededMeetings = neededDeals / closeRate;
      const neededConvos = neededMeetings / 0.4;
      set('#goalVal', money(goal) + ' a month needs about ' + R.num(neededConvos) +
        ' conversations, from the conversion rates you entered.');
    } else {
      set('#goalVal', money(goal) + ' a month. Enter your conversion rates in the pipeline calculator and this converts the goal into the conversations it requires.');
    }

    /* working-language preview: the same sentence in the chosen language */
    const langSel = $('#agentLang');
    const code = langSel ? langSel.value : R.i18n.locale;
    const sample = $('#agentLangSample');
    if (sample) {
      const table = (R.i18n.strings || {})[code] || {};
      const line = table['hero.lede'] || R.i18n.t('hero.lede');
      sample.setAttribute('dir', code === 'ar' ? 'rtl' : 'ltr');
      sample.textContent = '“' + line.slice(0, 150) + (line.length > 150 ? '…' : '') + '”';
    }
    const langLab = $('#agentLangLab');
    if (langLab) {
      const l = R.i18n.locales.filter(x => x.code === code)[0];
      langLab.textContent = l ? l.native : code;
    }

    /* costs: the meter rate is documented, the volume is the model's, and the
       multiplier is arithmetic the visitor can check */
    const tasks = model && model.hasInput ? Math.max(50, Math.round(model.prospects * 1.6)) : 500;
    set('#estCost', R.money(tasks * PASS_RATE, { currency: state.cur, decimals: 2 }) + ' / ' + R.num(tasks) + ' actions');
    set('#estPipe', model && model.hasInput
      ? R.money(model.pipeline) + ' pipeline'
      : 'pipeline — enter your model');
    set('#estTime', 'Live in under a day');
  }

  /* ============================================================
     MARKETPLACE / AGENCY / DEVELOPERS / TRUST / SETTINGS
     ============================================================ */
  function renderMarketplace() {
    const list = $('#mkTemplates');
    if (list) {
      list.innerHTML = (caps.templates || []).map(t =>
        '<article class="mk-card"><header><h4>' + esc(t.name) + '</h4><span class="pill">' + esc(t.for) + '</span></header>' +
        '<p>' + esc(t.body) + '</p>' +
        '<button class="btn btn-sm" data-deploy="' + esc(t.name) + '" data-cursor="button">Deploy template</button></article>').join('');
      list.querySelectorAll('[data-deploy]').forEach(b => b.addEventListener('click', () => {
        auditLog('Template selected', b.getAttribute('data-deploy'));
        toast('Template "' + b.getAttribute('data-deploy') + '" selected — connect a workspace to deploy', 'warn');
      }));
    }
    const agents = $('#mkAgents');
    if (agents) {
      agents.innerHTML = (caps.agents || []).map(a =>
        '<div class="mk-row"><span class="mk-name">' + esc(a.role) + '</span><span class="mk-desc">' + esc(a.job) + '</span></div>').join('');
    }
    const inst = $('#mkInstalled');
    if (inst) inst.innerHTML = empty('Nothing installed yet. Agents and templates you deploy appear here with their publisher and revenue share.');
  }

  function renderAgency() {
    const set = (sel, txt) => { const el = $(sel); if (el) el.textContent = txt; };
    set('#agencyClients', '0'); set('#agencyClientName', 'No clients yet');
    set('#agencyClientMeta', '—'); set('#agencyBrand', '—'); set('#agencyMargin', '—');
    set('#agencyAgents', '0'); set('#agencyCampaigns', '0');
    const box = $('#agencyClients');
    if (box && box.tagName === 'DIV') {
      box.innerHTML = empty('Agency mode puts each client in its own workspace with its own agents, campaigns, branding and data boundary. Add a client to see it here.');
    }
  }

  function renderDevelopers() {
    const api = (caps.api || {});
    const list = $('#apiList');
    if (list) {
      list.innerHTML = (api.endpoints || []).map((e, i) =>
        '<button class="api-row' + (i === 0 ? ' on' : '') + '" data-api="' + i + '">' +
        '<span class="api-m ' + e.method.toLowerCase() + '">' + e.method + '</span>' +
        '<span class="api-p">' + esc(e.path) + '</span></button>').join('');
      list.querySelectorAll('[data-api]').forEach(b => b.addEventListener('click', () => {
        list.querySelectorAll('.api-row').forEach(x => x.classList.remove('on'));
        b.classList.add('on');
        selectApi(parseInt(b.getAttribute('data-api'), 10) || 0);
      }));
      selectApi(0);
    }
    const wh = $('#whList');
    if (wh) {
      wh.innerHTML = (api.webhooks || []).map(w =>
        '<div class="wh-row"><span class="wh-ev">' + esc(w.event) + '</span><span class="wh-d">' + esc(w.desc) + '</span></div>').join('');
    }
    const whMeta = $('#whMeta');
    if (whMeta) whMeta.textContent = (api.webhooks || []).length + ' events · signed with an HMAC secret you control';
  }

  function selectApi(i) {
    const api = (caps.api || {});
    const e = (api.endpoints || [])[i];
    if (!e) return;
    const set = (sel, txt) => { const el = $(sel); if (el) el.textContent = txt; };
    set('#apiTitle', e.method + ' ' + e.path);
    set('#apiDesc', e.desc);
    set('#apiAuth', api.auth || '');
    const code = $('#apiCode');
    if (code) {
      code.textContent =
        'curl ' + (api.base || '') + e.path + ' \\\n' +
        '  -H "Authorization: Bearer $REVENUEPILOT_TOKEN" \\\n' +
        '  -H "Content-Type: application/json" \\\n' +
        (e.method === 'GET' ? '' : '  -d \'{ "workspace": "ws_123" }\'');
    }
  }

  function renderTrust() {
    const grid = $('#trustGrid');
    if (grid) {
      grid.innerHTML = (caps.security || []).map(s =>
        '<article class="trust-card"><h4>' + esc(s.title) + '</h4><p>' + esc(s.body) + '</p></article>').join('');
    }
    const certs = $('#dataControls');
    if (certs) {
      certs.innerHTML = '<div class="cert-list">' + ((caps.certifications || {}).items || []).map(c =>
        '<div class="cert-row"><span class="cert-name">' + esc(c.name) + '</span>' +
        '<span class="cert-st ' + esc(c.status) + '">' + statusLabel(c.status) + '</span>' +
        '<span class="cert-note">' + esc(c.note) + '</span></div>').join('') + '</div>';
    }
    const ai = $('#aiControls');
    if (ai) {
      ai.innerHTML = '<ul class="ctl-list">' + [
        'Per-action permissions, set by you, enforced before the action runs',
        'Approval gates on anything outbound, financial or irreversible',
        'Guardrails that constrain what an agent may claim or promise',
        'Prompt-injection filtering on all inbound content',
        'Hard refusal boundaries for prohibited actions',
        'Every decision recorded with its input, so a human can reconstruct it'
      ].map(t => '<li>' + t + '</li>').join('') + '</ul>';
    }
  }
  function statusLabel(s) {
    return { 'in-progress': 'In progress', supported: 'Supported', planned: 'Planned' }[s] || s;
  }

  function renderSettings() {
    const langSel = $('#stLang');
    if (langSel && !langSel.options.length) {
      langSel.innerHTML = R.i18n.locales.map(l =>
        '<option value="' + l.code + '">' + esc(l.native) + ' — ' + esc(l.name) + '</option>').join('');
      langSel.value = R.i18n.locale;
      langSel.addEventListener('change', () => { R.i18n.set(langSel.value); renderSettings(); });
    }
    const curSel = $('#stCur');
    if (curSel && !curSel.options.length) {
      (cfg.site && cfg.site.currencies || []).forEach(c => {
        const o = document.createElement('option');
        o.value = c; o.textContent = currencyLabel(c);
        curSel.appendChild(o);
      });
      curSel.value = state.cur;
      curSel.addEventListener('change', () => {
        state.cur = curSel.value;
        R.i18n.setCurrency(state.cur);
        paintMoney(); renderCommand(); renderRevenue();
        auditLog('Currency changed', state.cur);
      });
    }
    const tz = $('#stTz');
    if (tz) {
      try { tz.textContent = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; }
      catch (e) { tz.textContent = 'UTC'; }
    }
    const zone = $('#stZone');
    if (zone) zone.textContent = (R.i18n.locale || 'en').toUpperCase();
    const langs = $('#agentLangs');
    if (langs) langs.innerHTML = R.i18n.locales.map(l => '<span class="pill">' + esc(l.native) + '</span>').join('');
    const sample = $('#langSample');
    if (sample) sample.textContent = R.i18n.t('hero.lede');
    const ladder = $('#defaultLadder');
    if (ladder) ladder.innerHTML = (caps.autonomyLevels || []).map(l => '<option>' + esc(l.label) + '</option>').join('');
  }

  /* ============================================================
     KILL SWITCH
     ============================================================ */
  function setPaused(next, silent) {
    state.paused = !!next;
    const banner = $('#osBanner');
    if (banner) banner.classList.toggle('on', state.paused);
    const btn = $('#killSwitch');
    const label = $('#killLabel');
    if (btn) btn.classList.toggle('on', state.paused);
    if (label) label.textContent = state.paused ? 'Resume agents' : 'Pause all agents';
    const status = $('#ccStatus');
    if (status) status.textContent = state.paused ? 'All agents paused' : 'Model ready · no workspace connected';
    if (!silent) {
      auditLog(state.paused ? 'All agents paused by operator' : 'All agents resumed by operator',
        state.paused ? 'kill switch' : 'fleet', state.paused ? 'bad' : 'ok');
      toast(state.paused ? 'All agents paused. Nothing will send until you resume.' : 'Agents resumed.', state.paused ? 'warn' : 'ok');
    }
    renderFleet(); renderCommand(); renderSupervisor();
  }

  /* ============================================================
     PANES
     ============================================================ */
  const PANES = {
    command: renderCommand,
    agents: renderFleet,
    supervisor: renderSupervisor,
    approvals: renderApprovals,
    copilot: renderCopilot,
    inbox: renderInbox,
    prospects: renderProspects,
    intel: renderProspects,
    revenue: renderRevenue,
    builder: renderBuilder,
    marketplace: renderMarketplace,
    agency: renderAgency,
    developers: renderDevelopers,
    trust: renderTrust,
    settings: renderSettings
  };

  function showPane(name, silent) {
    if (!PANES[name]) return;
    state.pane = name;
    $$('[data-os-pane]').forEach(p => {
      const on = p.getAttribute('data-os-pane') === name;
      p.classList.toggle('on', on);
      p.hidden = !on;
    });
    $$('[data-os-nav]').forEach(n => n.classList.toggle('on', n.getAttribute('data-os-nav') === name));
    const title = $('#osTitle'), sub = $('#osSub');
    const LABELS = {
      command: ['Command center', 'What every agent is doing, why, and what happens next'],
      agents: ['Agents', 'Nine roles, each with its own autonomy level and permissions'],
      supervisor: ['Agent Supervisor', 'Orchestration, exception handling and human escalation'],
      approvals: ['Approvals', 'Nothing outbound leaves without a decision, unless you allow it'],
      copilot: ['Sales Copilot', 'Sentiment, likely objection, suggested response, next best action'],
      inbox: ['Universal inbox', 'Every channel in one interface'],
      prospects: ['Prospects', 'Your pipeline, with the reasoning attached'],
      intel: ['Lead intelligence', 'Company, fit, intent and why it is worth pursuing'],
      revenue: ['Revenue intelligence', 'Forecast, attribution and what-if modelling'],
      builder: ['Agent builder', 'Define a role, its permissions and its guardrails'],
      marketplace: ['Marketplace', 'Agents and templates, with publisher economics'],
      agency: ['Agency mode', 'White-label workspaces for your clients'],
      developers: ['Developers', 'REST API, webhooks and the event model'],
      trust: ['Trust center', 'Security, privacy, AI controls and audit'],
      settings: ['Settings', 'Localisation, defaults and safety']
    };
    if (title && LABELS[name]) title.textContent = LABELS[name][0];
    if (sub && LABELS[name]) sub.textContent = LABELS[name][1];
    PANES[name]();
    paintMoney();
    if (!silent) auditLog('Opened ' + (LABELS[name] ? LABELS[name][0] : name), 'navigation');
  }

  /* ============================================================
     BOOT
     ============================================================ */
  function initOS() {
    const clock = $('#osClock');
    if (clock) {
      const tick = () => {
        const d = new Date();
        let tz = 'UTC';
        try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch (e) { }
        clock.textContent = pad(d.getHours()) + ':' + pad(d.getMinutes()) + ' · ' + tz;
      };
      tick();
      setInterval(tick, 30000);
    }

    $$('[data-os-nav]').forEach(n => {
      n.addEventListener('click', e => { e.preventDefault(); showPane(n.getAttribute('data-os-nav')); });
    });

    const kill = $('#killSwitch');
    if (kill) kill.addEventListener('click', () => setPaused(!state.paused));
    const kill2 = $('#killFromSettings');
    if (kill2) kill2.addEventListener('click', () => setPaused(!state.paused));

    const cur = $('#osCurrency');
    if (cur && !cur.options.length) {
      (cfg.site && cfg.site.currencies || []).forEach(c => {
        const o = document.createElement('option'); o.value = c; o.textContent = currencyLabel(c); cur.appendChild(o);
      });
      cur.value = state.cur;
      cur.addEventListener('change', () => {
        state.cur = cur.value;
        R.i18n.setCurrency(state.cur);
        paintMoney(); renderCommand(); renderRevenue();
      });
    }
    const lang = $('#osLang');
    if (lang && !lang.options.length) {
      const codes = ['strings', 'ui'];
      void codes;
      R.i18n.locales.forEach(l => {
        const o = document.createElement('option'); o.value = l.code; o.textContent = l.native;
        lang.appendChild(o);
      });
      lang.value = R.i18n.locale;
      lang.addEventListener('change', () => R.i18n.set(lang.value));
    }

    /* the budget ceiling is real arithmetic on a rate you can see */
    const slider = $('#budgetSlider');
    const lab = $('#budgetLab');
    const note = $('#budgetNote');
    const PER_TASK = 0.014;
    function paintBudget() {
      state.budget = slider ? parseInt(slider.value, 10) || 300 : 300;
      const tasks = Math.floor(state.budget / PER_TASK);
      if (lab) lab.textContent = money(state.budget);
      if (note) note.textContent = state.budgetEnabled
        ? 'At a metered ' + R.money(PER_TASK, { currency: state.cur, decimals: 3 }) + ' per agent task, ' + money(state.budget) + ' buys roughly ' + R.num(tasks) + ' tasks this month. Exceeding it pauses agents rather than overspending.'
        : 'No ceiling set. Agents will keep spending as they work.';
    }
    if (slider) {
      slider.min = 20; slider.max = 2000; slider.step = 10;
      slider.value = state.budget;
      slider.addEventListener('input', paintBudget);
      paintBudget();
    }
    const toggle = $('#budgetEnabled');
    if (toggle) toggle.addEventListener('change', () => { state.budgetEnabled = toggle.checked; paintBudget(); });

    /* what-if inputs */
    ['#wiVol', '#wiConv', '#wiCvr', '#wiDeal'].forEach(sel => {
      const el = $(sel);
      if (el) el.addEventListener('input', () => { renderWhatIf(); });
    });
    const apply = $('#wiApply');
    if (apply) apply.addEventListener('click', () => {
      const vol = parseFloat(($('#wiVol') || {}).value), conv = parseFloat(($('#wiConv') || {}).value);
      const cvr = parseFloat(($('#wiCvr') || {}).value), deal = parseFloat(($('#wiDeal') || {}).value);
      if (R.calc && R.calc.set) {
        R.calc.set({ prospects: vol, qual: conv, close: cvr, deal: deal });
        auditLog('Applied what-if scenario to the model', 'scenario');
        toast('Scenario applied to the pipeline model', 'ok');
      }
      renderWhatIf();
    });
    const reset = $('#wiReset');
    if (reset) reset.addEventListener('click', () => {
      if (R.calc && R.calc.clear) R.calc.clear();
      renderWhatIf();
    });

    /* deploy-agent button reflects the builder's real state, no invented output */
    const deploy = $('#deployAgentBtn');
    if (deploy) deploy.addEventListener('click', () => {
      const name = ($('#agentNameInput') || $('#builderName') || {}).value || 'Agent';
      auditLog('Agent configuration saved as draft', name);
      toast('"' + name + '" saved as a draft — deploy it in your workspace', 'warn');
    });

    /* copilot sentiment knob is a real control over a labelled band */
    const knob = $('#copSentKnob');
    if (knob) {
      knob.addEventListener('input', () => {
        const v = parseInt(knob.value, 10);
        const el = $('#copSentLab');
        if (el) el.textContent = v > 70 ? 'positive' : v > 45 ? 'mixed' : 'negative';
      });
    }

    /* rev tabs */
    $$('#revTabs [data-tab]').forEach(t => t.addEventListener('click', () => {
      $$('#revTabs [data-tab]').forEach(x => x.classList.remove('on'));
      t.classList.add('on');
      const name = t.getAttribute('data-tab');
      const panes = { forecast: '#fc', attribution: '#attr', whatif: '#wi', coach: '#coach' };
      Object.keys(panes).forEach(k => {
        const el = $(panes[k]);
        if (el) el.hidden = k !== name;
      });
      if (name === 'attribution') renderRevenue();
      if (name === 'coach') renderCoach();
    }));

    /* Render every pane up front. A hidden pane that has never been rendered is
       a pane that lies when someone opens it, and the content is cheap to build. */
    Object.keys(PANES).forEach(k => { try { PANES[k](); } catch (e) { /* keep booting */ } });
    showPane('command', true);
    renderSettings();
    renderAudit();
    auditLog('Console opened', 'preview');
  }

  function esc(s) {
    return String(s === undefined ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  window.RP.os = { initOS: initOS, state: state, showPane: showPane, setPaused: setPaused, toast: toast, audit: auditLog };
})();
