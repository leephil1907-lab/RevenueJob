/* ============================================================
   LAYER 4 — scroll choreography + product surfaces
   pinned story · agent core graph · dashboard preview ·
   pricing · testimonials · faq · parallax
   ============================================================ */
(function () {
  'use strict';
  const R = window.RP;
  const { $, $$, clamp, lerp, Engine, REDUCED, MOBILE, easeOutCubic, easeInOutCubic, money } = R;

  /* ---------- data ---------- */
  const SCENES = [
    { t: 'A prospect enters the system.', d: 'An anonymous intent signal resolves to a real account and lands in the agent queue — with context attached, not a raw lead row.' },
    { t: 'The agent researches them.', d: 'Twelve sources are reconciled in under three seconds: firmographics, tech stack, hiring velocity, and the specific pain your product removes.' },
    { t: 'The agent starts the conversation.', d: 'A message is composed for this account only — referencing the trigger event, in the voice you configured, inside the policy limits you set.' },
    { t: 'The prospect responds.', d: 'Sentiment, intent and objections are parsed on arrival. Replies that signal buying motion escalate immediately.' },
    { t: 'AI qualifies the opportunity.', d: 'MEDDPICC scoring runs against the transcript. Watch the score climb as each buying criterion is confirmed.' },
    { t: 'Meeting booked.', d: 'The agent proposes real availability, books the slot, writes the brief and hands off to a human AE with full context.' },
    { t: 'Revenue appears.', d: 'One signal, zero human touches, one closed contract. Multiply by the accounts your market is producing right now.' }
  ];
  /* No invented opportunity score: the ring counts how many of the five
     qualification criteria the walkthrough has reached, and the ticks carry
     the definition of each one. */
  const scoreStops = [0, .3, .46, .58, .7, .82];
  /* No invented revenue curve: the final panel mirrors the visitor's own model
     from the pipeline calculator, and the bars scale to it. */
  const revStops = [0, .16, .38, .62, .9];
  const revVals = null;   // resolved at runtime from RP.calc
  /* The walkthrough uses tokens, not a fabricated customer: the section is
     labelled "a scenario, not a customer" and nothing here is presented as a
     real company, a real person or a real result. */
  const PAIN = 'manual research · slow follow-up · long ramp to first deal';
  const SUBJECT = 'How [Company] could reach first deal faster';
  const BODY = 'Hi [First name] — noticed [Company] has been hiring on the go-to-market side.\n\nMost teams at that stage lose their first 90 days to manual research and slow follow-up. RevenuePilot runs agents that do both, continuously, against your exact ICP.\n\nWorth 15 minutes on Thursday? I can show you the account trace for a company like yours.';

  function stepped(p, stops, vals) {
    for (let i = 0; i < stops.length - 1; i++) {
      if (p <= stops[i + 1]) {
        const t = (p - stops[i]) / (stops[i + 1] - stops[i]);
        return { v: lerp(vals[i], vals[i + 1], easeInOutCubic(clamp(t, 0, 1))), i: i };
      }
    }
    return { v: vals[vals.length - 1], i: vals.length - 1 };
  }

  /* ============================================================
     PINNED STORY — scroll as product demonstration
     ============================================================ */
  function initStory() {
    const track = $('#storyTrack');
    const stage = $('#storyStage');
    if (!track || !stage) return;
    const panels = $$('.panel', stage);
    const steps = $$('#storySteps .step');
    const titleEl = $('#storyTitle'), descEl = $('#storyDesc'), bar = $('#storyBar');

    // stage 1
    const p1Signal = $('[data-p1="signal"]'), p1Score = $('[data-p1="score"]'), p1Scan = $('.scan i', panels[0]);
    // stage 2
    const p2Fields = $$('[data-at]', panels[1]);
    const p2Pain = $('[data-p2="pain"]');
    // stage 3
    const p3Sub = $('[data-p3="subject"]'), p3Body = $('[data-p3="body"]'), p3Caret = $('[data-p3="caret"]');
    // stage 4
    const p4 = { me: $('[data-p4="me"]'), them: $('[data-p4="them"]'), me2: $('[data-p4="me2"]') };
    // stage 5
    const ring = $('#scoreRing'), scoreVal = $('#scoreVal'), ticks = $$('#scoreTicks .tick');
    const CIRC = 2 * Math.PI * 52;
    // stage 6
    const slot = $('[data-p6="slot"]'), slot2 = $('[data-p6="slot2"]'), booking = $('[data-p6="booking"]');
    const calDays = $$('[data-cal]');
    // stage 7
    const revEl = $('#storyRev'), bars = $$('#storyBars i');

    let curScene = -1, progress = 0, visible = true;

    function setTitle(i) {
      if (curScene === i) return;
      if (REDUCED) { titleEl.textContent = SCENES[i].t; descEl.textContent = SCENES[i].d; }
      else {
        titleEl.style.transition = 'opacity .28s ease, transform .34s var(--e-out)';
        descEl.style.transition = 'opacity .28s ease, transform .34s var(--e-out)';
        titleEl.style.opacity = 0; descEl.style.opacity = 0;
        titleEl.style.transform = 'translateY(-8px)'; descEl.style.transform = 'translateY(-6px)';
        setTimeout(() => {
          titleEl.textContent = SCENES[i].t; descEl.textContent = SCENES[i].d;
          titleEl.style.opacity = 1; descEl.style.opacity = 1;
          titleEl.style.transform = ''; descEl.style.transform = '';
        }, 200);
      }
      steps.forEach((s, si) => {
        s.classList.toggle('active', si === i);
        s.classList.toggle('done', si < i);
      });
      curScene = i;
    }

    /* per-scene progressive reveals (idempotent) */
    /* The booking panel shows the real current week. Nothing about the dates is
     invented: they are read from the visitor's own clock. */
  function paintCalendar() {
    if (!calDays.length) return;
    const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const today = new Date();
    calDays.forEach(el => {
      const off = parseInt(el.getAttribute('data-cal'), 10) || 0;
      const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + off);
      const n = d.getDate();
      const wd = el.querySelector('span'), num = el.querySelector('b');
      if (wd) wd.textContent = names[d.getDay()];
      if (num) num.textContent = String(n);
      el.setAttribute('data-iso', d.toISOString().slice(0, 10));
      if (off === 0) el.classList.add('today');
    });
  }
  paintCalendar();

  /* Reduced motion: the whole walkthrough is presented complete and static —
     every criterion marked, every field revealed — so nothing needs animating. */
  function paintStaticStory() {
    if (!REDUCED) return;
    $$('#scoreTicks .tick').forEach(t => { t.dataset.on = '1'; t.classList.add('on'); });
    const ring = $('#scoreRing'), sv = $('#scoreVal');
    if (ring) ring.setAttribute('stroke-dashoffset', '0');
    if (sv) sv.textContent = String($$('#scoreTicks .tick').length);
    const pain = $('[data-p2="pain"]');
    if (pain) pain.textContent = PAIN;
    const sig = $('[data-p1="signal"]');
    if (sig) sig.textContent = 'Signal detected · sources dated';
    const sc = $('[data-p1="score"]');
    if (sc) { sc.textContent = 'scoring'; sc.style.color = 'var(--cy)'; }
    $$('.field[data-at]').forEach(f => { f.dataset.on = '1'; f.style.opacity = 1; f.style.transform = 'none'; });
    $$('[data-p6="slot"], [data-p6="slot2"]').forEach(el => el.classList.add('on'));
    const bk = $('[data-p6="booking"]');
    if (bk) bk.classList.add('on');
  }
  paintStaticStory();

  function paint(i, p) {
      const el = panels[i];
      if (i === 0) {
        const s = stepped(p, [0, .3], [0, 1]);
        if (p1Scan) p1Scan.style.width = (30 + 70 * s.v).toFixed(0) + '%';
        if (p1Signal && p > .32 && !p1Signal.dataset.done) { p1Signal.dataset.done = '1'; p1Signal.textContent = 'Signal detected · sources dated'; }
        if (p1Score && p > .5 && !p1Score.dataset.done) { p1Score.dataset.done = '1'; p1Score.textContent = 'scoring'; p1Score.style.color = 'var(--cy)'; }
      }
      if (i === 1) {
        p2Fields.forEach(f => {
          const at = parseFloat(f.dataset.at);
          const on = p >= at;
          if (f.dataset.on === (on ? '1' : '0')) return;
          f.dataset.on = on ? '1' : '0';
          f.style.transition = 'opacity .5s ease, transform .6s var(--e-out), filter .6s ease';
          f.style.opacity = on ? 1 : 0;
          f.style.transform = on ? 'none' : 'translateY(10px)';
          f.style.filter = on ? 'blur(0)' : 'blur(3px)';
        });
        if (p2Pain && p > .5 && !p2Pain.dataset.done) { p2Pain.dataset.done = '1'; p2Pain.textContent = PAIN; }
      }
      if (i === 2) {
        const typeP = clamp((p - .06) / .68, 0, 1);
        const chars = Math.floor(typeP * BODY.length);
        const subChars = Math.floor(clamp((p - .02) / .2, 0, 1) * SUBJECT.length);
        if (p3Sub) p3Sub.textContent = SUBJECT.slice(0, subChars) + (subChars < SUBJECT.length ? '▍' : '');
        if (p3Body) p3Body.textContent = BODY.slice(0, chars);
        if (p3Caret) {
          p3Caret.style.display = typeP >= 1 ? 'none' : 'inline-block';
          if (typeP < 1) p3Body.appendChild(p3Caret);
        }
      }
      if (i === 3) {
        const marks = [[p4.me, .04], [p4.them, .3], [p4.me2, .58]];
        marks.forEach(m => {
          if (!m[0]) return;
          const on = p >= m[1];
          if (m[0].dataset.on === (on ? '1' : '0')) return;
          m[0].dataset.on = on ? '1' : '0';
          m[0].classList.toggle('in', on);
        });
      }
      if (i === 4) {
        let met = 0;
        scoreStops.forEach((at, k) => { if (k > 0 && p >= at) met = k; });
        if (ring) ring.setAttribute('stroke-dashoffset', (CIRC * (1 - met / 5)).toFixed(1));
        if (scoreVal) scoreVal.textContent = met;
        ticks.forEach((t, ti) => {
          const on = p >= parseFloat(t.dataset.at || '1');
          if (t.dataset.on !== (on ? '1' : '0')) {
            t.dataset.on = on ? '1' : '0';
            t.classList.toggle('on', on);
          }
        });
      }
      if (i === 5) {
        if (slot) slot.classList.toggle('on', p > .08);
        if (slot2) slot2.classList.toggle('on', p > .2);
        if (booking) booking.classList.toggle('on', p > .3);
      }
      if (i === 6) {
        /* the closing panel shows the visitor's own model, not a scripted curve.
           With no inputs it stays a prompt — the page never invents a result. */
        const model = (window.RP.calc && window.RP.calc.model()) || null;
        const target = model && model.hasInput ? model.expected : 0;
        if (revEl) {
          revEl.textContent = model && model.hasInput ? money(target) : '—';
          if (!model || !model.hasInput) revEl.setAttribute('data-empty', '1');
          else revEl.removeAttribute('data-empty');
        }
        bars.forEach((b, bi) => {
          const wave = target > 0 ? clamp((stepped(p, revStops, [0, .18, .42, .7, 1]).v) - bi * .042, 0, 1) : 0;
          b.style.height = (wave * 100).toFixed(1) + '%';
        });
      }
      // incoming panel pre-roll: next panel's first beat is already warm
      void el;
    }

    /* metrics are cached: the scrub reads only window.pageYOffset per frame,
       so it never forces a synchronous reflow. Revalidated on resize + every 1s. */
    let m = { vh: 0, top: 0, total: 0 };
    function measure() {
      m.vh = window.innerHeight;
      m.top = track.getBoundingClientRect().top + window.pageYOffset;
      m.total = Math.max(1, track.offsetHeight - m.vh);
    }

    function layout() {
      const vh = m.vh || window.innerHeight;
      const total = m.total;
      const scrolled = clamp(window.pageYOffset - m.top, 0, total);
      progress = total > 0 ? scrolled / total : 0;
      const pos = progress * 7;
      const scene = clamp(Math.floor(pos), 0, 6);
      const p = clamp(pos - scene, 0, 1);
      setTitle(scene);
      panels.forEach((panel, i) => {
        const d = pos - i;
        const ad = Math.abs(d);
        const vis = ad < 1 ? 1 : 0;
        if (vis === 0) {
          if (panel.style.display !== 'none') { panel.style.display = 'none'; }
          return;
        }
        if (panel.style.display === 'none') panel.style.display = '';
        const o = 1 - clamp(ad, 0, 1);
        panel.style.opacity = (o * (MOBILE ? 1 : .25 + .75 * o)).toFixed(3);
        panel.style.transform = 'translate3d(0,' + (-d * 42).toFixed(1) + 'px,0) scale(' + (1 - ad * .035).toFixed(4) + ')';
        panel.style.filter = 'blur(' + (ad * 7).toFixed(2) + 'px)';
        panel.style.zIndex = String(10 - Math.round(ad * 4));
        panel.style.pointerEvents = ad < .5 ? 'auto' : 'none';
      });
      paint(scene, p);
      if (bar) bar.style.width = (progress * 100).toFixed(2) + '%';
      const hint = $('.story-hint');
      if (hint) hint.style.opacity = progress > .02 ? '0' : '1';
    }

    if (REDUCED) {
      // static: show every panel stacked, fully populated
      track.style.height = 'auto';
      panels.forEach((panel, i) => {
        panel.style.display = 'block';
        panel.style.position = 'static';
        panel.style.opacity = 1;
        panel.style.transform = 'none';
        panel.style.filter = 'none';
        panel.style.marginBottom = '18px';
        paint(i, 1);
      });
      titleEl.textContent = SCENES[0].t; descEl.textContent = 'The full sequence, shown as static states.';
      if (p3Body) p3Body.textContent = BODY;
      if (p3Sub) p3Sub.textContent = SUBJECT;
      if (p3Caret) p3Caret.style.display = 'none';
      /* No revenue figure is claimed without the visitor's own inputs: the mirror
         stays '—' and the bars sit at their baseline. */
      if (revEl && !(window.RP.calc && window.RP.calc.model() && window.RP.calc.model().hasInput)) {
        revEl.textContent = '—';
      }
      const barsWrap = $('#storyBars');
      if (barsWrap) barsWrap.setAttribute('data-empty', '1');
      if (bar) bar.style.display = 'none';
      return;
    }

    // the scrub loop only runs while the pinned section is anywhere near the viewport,
    // and it is the single source of truth for scroll state (no scroll listeners needed)
    const near = R.gate($('#story') || track, .35);
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('orientationchange', measure);
    setInterval(measure, 1000);          // safety net for late layout shifts (fonts, route swaps)
    Engine.add({
      fn() {
        if (document.hidden || !near()) return;
        layout();
      }
    });
    layout();
  }

  /* ============================================================
     AGENT CORE — connected-path animation
     ============================================================ */
  function initCore() {
    const svg = $('.core-svg');
    if (!svg) return;
    const nodes = $$('.node', svg);
    const edges = {
      e1: $('#e1'), e2: $('#e2'), e3: $('#e3'), e4: $('#e4'),
      e5: $('#e5'), e6: $('#e6'), e7: $('#e7')
    };
    const pulseA = $('#pulseA'), pulseB = $('#pulseB');
    const gate = R.gate($('#coreStage'), .25);

    const N = {
      research: nodes.find(n => n.dataset.node === '0'),
      analyze: nodes.find(n => n.dataset.node === '1'),
      decide: nodes.find(n => n.dataset.node === '2'),
      qualified: nodes.find(n => n.dataset.node === '3'),
      nurture: nodes.find(n => n.dataset.node === '4'),
      convert: nodes.find(n => n.dataset.node === '5'),
      follow: nodes.find(n => n.dataset.node === '6')
    };

    function reset() {
      Object.keys(edges).forEach(k => edges[k] && edges[k].classList.remove('on'));
      nodes.forEach(n => n.classList.remove('live', 'ok'));
      if (pulseA) pulseA.setAttribute('opacity', '0');
      if (pulseB) pulseB.setAttribute('opacity', '0');
    }

    /* travel a pulse along an edge path */
    function travel(path, circle, dur) {
      return new Promise(res => {
        if (!path || !circle || REDUCED) { res(); return; }
        const len = path.getTotalLength();
        const t0 = performance.now();
        circle.setAttribute('opacity', '1');
        (function step(t) {
          const p = clamp((t - t0) / dur, 0, 1);
          const pt = path.getPointAtLength(easeOutCubic(p) * len);
          circle.setAttribute('cx', pt.x.toFixed(1));
          circle.setAttribute('cy', pt.y.toFixed(1));
          if (p < 1) requestAnimationFrame(step);
          else { circle.setAttribute('opacity', '0'); res(); }
        })(t0);
      });
    }

    function wait(ms) { return new Promise(r => setTimeout(r, REDUCED ? 0 : ms)); }

    async function run() {
      if (!gate()) return;
      reset();
      // main path
      if (N.research) N.research.classList.add('live');
      await wait(200);
      edges.e1.classList.add('on');
      await travel(edges.e1, pulseA, 620);
      N.research.classList.remove('live'); N.research.classList.add('ok');
      if (N.analyze) N.analyze.classList.add('live');
      edges.e2.classList.add('on');
      await travel(edges.e2, pulseA, 620);
      N.analyze.classList.remove('live'); N.analyze.classList.add('ok');
      if (N.decide) N.decide.classList.add('live');
      edges.e4.classList.add('on');
      await travel(edges.e4, pulseB, 700);
      N.decide.classList.remove('live'); N.decide.classList.add('ok');
      // branch: qualified path wins
      edges.e3.classList.add('on');
      await Promise.all([travel(edges.e3, pulseA, 760), wait(120)]);
      if (N.qualified) { N.qualified.classList.add('live'); N.qualified.classList.add('ok'); }
      if (N.nurture) { N.nurture.classList.add('ok'); }
      // nurture follow-up branch (opportunistic, dimmer)
      await wait(260);
      if (N.nurture) N.nurture.classList.remove('ok');
      edges.e5.classList.add('on');
      await travel(edges.e5, pulseA, 820);
      if (N.convert) { N.convert.classList.add('live'); N.convert.classList.add('ok'); }
      await wait(240);
      edges.e6.classList.add('on');
      await travel(edges.e6, pulseB, 640);
      N.convert && N.convert.classList.add('ok');
      if (N.follow) { edges.e7.classList.add('on'); N.follow.classList.add('live'); }
      // revenue terminal glows
      const revNode = nodes.find(n => n.dataset.node === '7');
      const rev = revNode ? $('.node-box', revNode) : null;
      if (revNode) revNode.classList.add('live');
      if (rev) { rev.style.stroke = 'rgba(90,231,255,.6)'; rev.style.fill = 'rgba(90,231,255,.10)'; }
      await wait(3600);
      if (revNode) revNode.classList.remove('live');
      if (rev) { rev.style.stroke = ''; rev.style.fill = ''; }
      run();
    }

    if (REDUCED) {
      Object.keys(edges).forEach(k => edges[k] && edges[k].classList.add('on'));
      nodes.forEach(n => n.classList.add('ok'));
      return;
    }
    run();
  }

  /* ============================================================
     DASHBOARD PREVIEW — the miniature product
     ============================================================ */
  /* ------------------------------------------------------------------
     DASHBOARD PREVIEW
     The miniature dashboard used to ship eight invented companies with
     invented fit scores, an invented agent log and invented campaign results.
     It now renders the visitor's own funnel: the stages come from the pipeline
     calculator, and every table shows an honest empty state until there is
     something real to show. Product *structure* is real; the data is yours or
     it is absent.
     ------------------------------------------------------------------ */

  /* Agent capabilities shown in the log panel are the documented steps an agent
     takes — not a transcript of a fictional run. */
  const AGENT_STEPS = [
    ['research', 'Sources reconciled against your ICP definition'],
    ['score', 'Fit score produced by your ICP model'],
    ['draft', 'Message drafted in your tone and length preferences'],
    ['policy', 'Approval policy and guardrails checked before send'],
    ['send', 'Sent through your connected mailbox'],
    ['book', 'Meeting placed against live calendar availability'],
    ['crm', 'Opportunity written to your CRM, field-level allowlist'],
    ['handoff', 'Brief and transcript passed to the named owner']
  ];

  function emptyRow(cols, message) {
    return '<div class="tr row is-empty"><span class="empty-cell" style="grid-column:1/-1">' + message + '</span></div>';
  }

  function rowHTML(p, i) {
    return '<div class="tr row" style="animation-delay:' + (i * 55) + 'ms">' +
      '<span class="co"><span class="av ' + p.v + '">' + p.i + '</span><b>' + p.n + '</b></span>' +
      '<span class="mono" style="color:var(--cy)">' + p.fit + '</span>' +
      '<span><span class="status ' + p.cls + '">' + p.stage + '</span></span>' +
      '<span class="hide-s muted">' + p.own + '</span>' +
      '<span class="hide-s"><span class="bar"><i data-w="' + p.score + '"></i></span></span>' +
      '</div>';
  }

  function fillTables() {
    const model = (window.RP.calc && window.RP.calc.model()) || null;
    const has = !!(model && model.hasInput);
    const num = window.RP.num, money = window.RP.money;

    ['#prospectTable', '#consoleTable'].forEach(sel => {
      const t = $(sel);
      if (!t) return;
      t.querySelectorAll('.tr.row').forEach(r => r.remove());
      if (!has) {
        t.insertAdjacentHTML('beforeend', emptyRow(5,
          'No prospects yet. Import a list or connect your CRM, then the agents fill this from your own pipeline.'));
        return;
      }
      /* the visitor's funnel, stage by stage — the same arithmetic as the calculator */
      const stages = [
        ['Prospects', model.prospects, 'sourced', ''],
        ['Qualified', model.qualified, 'scored against your ICP', 'cy'],
        ['Conversations', model.conversations, 'handled by agents', 'cy'],
        ['Meetings', model.meetings, 'booked on your calendar', 'vi'],
        ['Expected deals', model.deals, money(model.expected), 'ok']
      ];
      t.insertAdjacentHTML('beforeend', stages.map((r, i) =>
        '<div class="tr row" style="animation-delay:' + (i * 55) + 'ms">' +
        '<span class="co"><b>' + r[0] + '</b></span>' +
        '<span class="mono" style="color:var(--cy)">' + num(Math.round(r[1] * 10) / 10, { decimals: 1 }) + '</span>' +
        '<span><span class="status ' + r[3] + '">' + r[2] + '</span></span>' +
        '<span class="hide-s muted">your model</span>' +
        '<span class="hide-s"><span class="bar"><i data-w="' + Math.min(100, 100 - i * 14) + '"></i></span></span>' +
        '</div>').join(''));
    });

    /* the log panel explains what each agent step does — the sequence is the
       product's, the wording is documentation, not a transcript. */
    $$('#agentLog, #consoleAgentLog').forEach(box => {
      box.innerHTML = AGENT_STEPS.slice(0, 5).map((l, i) =>
        '<div class="logline" style="animation-delay:' + (i * 90) + 'ms">' +
        '<span class="tt">' + R.pad(1 + i) + '</span><span><b>' + l[0] + '</b> · ' + l[1] + '</span></div>'
      ).join('');
    });

    const cb = $('#campaignBars');
    if (cb) {
      cb.innerHTML = '<div class="logline" style="animation:none;display:grid;gap:7px">' +
        '<span><b>No campaigns yet</b></span>' +
        '<span class="muted" style="font-size:12.5px;line-height:1.5">Campaign performance appears here once an agent is connected to a mailbox and a sequence is live. Until then this panel stays empty rather than showing numbers you did not produce.</span>' +
        '</div>';
    }
    const cc = $('#consoleCampaigns');
    if (cc) cc.innerHTML = '<div class="logline" style="animation:none"><span class="muted">No campaigns yet — connect a mailbox to start one.</span></div>';

    /* KPI tiles mirror the model */
    document.querySelectorAll('[data-kpi="expected"]').forEach(el => { el.textContent = has ? money(model.expected) : '—'; });
    document.querySelectorAll('[data-kpi="deals"]').forEach(el => { el.textContent = has ? num(model.deals, { decimals: 1 }) : '—'; });
    document.querySelectorAll('[data-kpi="pipeline"]').forEach(el => { el.textContent = has ? money(model.pipeline) : '—'; });

    /* the revenue chart draws the visitor's funnel shape, or an empty grid */
    if (window.RP.charts && window.RP.charts.redraw) window.RP.charts.redraw();
  }

  /* ============================================================
     LINE CHART — draws your data, or says there is none
     ============================================================ */
  function LineChart(canvas, opts) {
    const options = opts || {};
    if (!canvas) return { draw() { }, reset() { } };
    const ctx = canvas.getContext && canvas.getContext('2d');
    if (!ctx) return { draw() { }, reset() { } };

    let prog = 0, raf = null, w = 0, h = 0, dpr = 1;
    let series = null;                       // null = no data, and it says so

    function size() {
      dpr = Math.min(window.devicePixelRatio || 1, 1.6);
      w = canvas.clientWidth || 600; h = canvas.clientHeight || 220;
      canvas.width = Math.floor(w * dpr); canvas.height = Math.floor(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function emptyState() {
      ctx.clearRect(0, 0, w, h);
      ctx.save();
      ctx.fillStyle = 'rgba(127,143,184,.85)';
      ctx.font = '12px ui-monospace, SFMono-Regular, Menlo, monospace';
      ctx.textAlign = 'center';
      ctx.fillText(options.emptyMessage || 'No data yet', w / 2, h / 2 - 4);
      ctx.fillStyle = 'rgba(93,107,144,.85)';
      ctx.fillText('this chart plots your own numbers', w / 2, h / 2 + 14);
      ctx.restore();
    }

    function draw() {
      size();
      if (!series || !series.length) { emptyState(); return; }
      const max = Math.max.apply(null, series) * 1.1 || 1;
      const pad = { l: 8, r: 8, t: 14, b: 18 };
      const iw = w - pad.l - pad.r, ih = h - pad.t - pad.b;

      ctx.clearRect(0, 0, w, h);
      /* grid */
      ctx.strokeStyle = 'var(--t-55)';
      ctx.lineWidth = 1;
      for (let i = 0; i <= 4; i++) {
        const y = pad.t + (ih / 4) * i;
        ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(pad.l + iw, y); ctx.stroke();
      }
      /* curve */
      const n = series.length;
      const px = i => pad.l + (i / (n - 1)) * iw;
      const py = v => pad.t + ih - (v / max) * ih;
      const grad = ctx.createLinearGradient(0, pad.t, 0, pad.t + ih);
      grad.addColorStop(0, 'rgba(90,231,255,.34)');
      grad.addColorStop(1, 'rgba(90,231,255,0)');

      ctx.beginPath();
      ctx.moveTo(px(0), py(series[0]));
      for (let i = 1; i < n; i++) ctx.lineTo(px(i), py(series[i]));
      ctx.strokeStyle = '#5ae7ff';
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      ctx.globalAlpha = prog;
      ctx.stroke();
      ctx.lineTo(px(n - 1), pad.t + ih);
      ctx.lineTo(px(0), pad.t + ih);
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    function animate() {
      prog = 0;
      cancelAnimationFrame(raf);
      const step = () => {
        prog = Math.min(1, prog + 0.045);
        draw();
        if (prog < 1) raf = requestAnimationFrame(step);
      };
      if (REDUCED) { prog = 1; draw(); } else step();
    }

    return {
      draw() { if (REDUCED) { prog = 1; } draw(); },
      reset() { prog = 0; },
      play() { animate(); },
      setSeries(values) { series = (values || []).slice(); },
      hasData() { return !!(series && series.length); }
    };
  }

  function initPreview() {
    const tabs = $$('.tab');
    const panes = $$('.panel-pane');
    const charts = {};
    const revCanvas = $('#revChart'), cRevCanvas = $('#consoleRevChart');
    if (revCanvas) charts.rev = LineChart(revCanvas);
    if (cRevCanvas) charts.crev = LineChart(cRevCanvas);

    function activate(name, root) {
      if (typeof activateBars === 'function') activateBars(root || document);
      $$('[data-count]', root || document).forEach(el => { el.dataset.done = ''; });
      setTimeout(() => {
        $$('[data-count]', root || document).forEach(el => { if (el.dataset.done !== '1' && isVisible(el)) { el.dataset.done = '1'; R.runCounter(el); } });
      }, 60);
      if (name === 'revenue' && charts.rev) { charts.rev.reset(); charts.rev.draw(); }
      if (name === 'revenue' && charts.crev) { charts.crev.reset(); charts.crev.draw(); }
      if (name === 'prospects') {
        $$('.tr.row', root || document).forEach((r, i) => {
          r.style.animation = 'none'; void r.offsetWidth;
          r.style.animation = 'rowIn .6s var(--e-out) ' + (i * 55) + 'ms forwards';
        });
      }
    }
    function isVisible(el) {
      const r = el.getBoundingClientRect();
      return r.top < window.innerHeight && r.bottom > 0;
    }

    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        const name = tab.dataset.pane;
        tabs.forEach(t => { t.classList.toggle('on', t === tab); t.setAttribute('aria-selected', t === tab ? 'true' : 'false'); });
        panes.forEach(p => p.classList.toggle('on', p.dataset.paneBody === name));
        const wrap = $('#panelwrap');
        const root = wrap ? $('[data-pane-body="' + name + '"]', wrap) : null;
        activate(name, root);
        if (window.RP && window.RP.cursorPulse) window.RP.cursorPulse();
      });
    });

    // clock
    const clock = $('#pvClock');
    if (clock) {
      const tick = () => {
        const d = new Date();
        clock.textContent = R.pad(d.getHours()) + ':' + R.pad(d.getMinutes()) + ':' + R.pad(d.getSeconds()) + ' UTC';
      };
      tick(); setInterval(tick, 1000);
    }

    /* The agent log describes the real sequence of agent steps and states
       plainly that it is a description, not a live workspace. There is no
       generated activity stream: a page that fakes motion is a page you
       cannot trust with a revenue number. */
    const status = $('#agentStatus');
    if (status) status.textContent = 'Not connected — this is a worked example of the sequence';

    /* the agent log panel reflects the visitor's model when they have entered
       one, so the panel is never decorative-but-meaningless */
    function paintSteps() {
      const box = $('#agentLog');
      if (!box) return;
      const model = (window.RP.calc && window.RP.calc.model()) || null;
      const tail = model && model.hasInput
        ? 'your model: ' + window.RP.num(model.deals, { decimals: 1 }) + ' expected deals per month'
        : 'enter your numbers above to see the sequence applied to them';
      box.innerHTML = AGENT_STEPS.slice(0, 5).map((l, i) =>
        '<div class="logline"><span class="tt">' + R.pad(i + 1) + '</span><span><b>' + l[0] + '</b> · ' + l[1] + '</span></div>'
      ).join('') + '<div class="logline" style="opacity:.75"><span class="tt">→</span><span>' + tail + '</span></div>';
    }
    paintSteps();
    if (window.RP.calc && window.RP.calc.on) window.RP.calc.on(paintSteps);

    // draw charts when their pane is first shown
    const revPane = $('[data-pane-body="revenue"]');
    if (revPane) {
      const io = new IntersectionObserver(es => es.forEach(e => {
        if (e.isIntersecting) { charts.rev && charts.rev.draw(); }
      }), { threshold: .3 });
      io.observe(revPane);
    }
    const cRev = $('[data-cbody="revenue"]');
    if (cRev) {
      const io = new IntersectionObserver(es => es.forEach(e => {
        if (e.isIntersecting) { charts.crev && charts.crev.draw(); }
      }), { threshold: .3 });
      io.observe(cRev);
    }

    // initial activation for the default pane
    const first = $('#panelwrap .panel-pane.on');
    if (first) setTimeout(() => activate('prospects', first), 400);
    return { activate, charts };
  }

  /* ============================================================
     PRICING — number transitions, stable features
     ============================================================ */
  function initPricing() {
    const toggle = $('#billToggle'), slide = $('#togSlide');
    if (!toggle) return;
    const btns = $$('button', toggle);
    const nums = $$('.price-num[data-price]');
    const notes = $$('.billnote');
    let mode = 'monthly';

    function placeSlide() {
      const active = btns.find(b => b.classList.contains('on'));
      if (!active || !slide) return;
      slide.style.left = active.offsetLeft + 'px';
      slide.style.width = active.offsetWidth + 'px';
    }
    function animateNum(el, to, annualNote) {
      const from = parseFloat(el.textContent.replace(/[^\d]/g, '')) || 0;
      if (REDUCED) { el.textContent = to; return; }
      const t0 = performance.now(), dur = 420;
      (function step(t) {
        const p = clamp((t - t0) / dur, 0, 1);
        el.textContent = Math.round(lerp(from, to, easeOutCubic(p)));
        if (p < 1) requestAnimationFrame(step); else el.textContent = to;
      })(t0);
      void annualNote;
    }
    function setMode(next) {
      mode = next;
      btns.forEach(b => { const on = b.dataset.bill === mode; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); });
      placeSlide();
      nums.forEach(el => {
        const target = mode === 'annual' ? parseFloat(el.dataset.priceAnnual) : parseFloat(el.dataset.price);
        el.textContent = target;
        el.style.transform = '';
        if (!REDUCED) { el.style.transform = 'translateY(6px)'; requestAnimationFrame(() => { el.style.transition = 'transform .42s var(--e-out)'; el.style.transform = ''; }); }
        animateNum(el, target);
      });
      notes.forEach(n => {
        n.style.opacity = 0;
        setTimeout(() => {
          n.textContent = mode === 'annual' ? 'Billed annually · save 20%' : 'Billed monthly';
          n.style.opacity = 1;
        }, 180);
      });
    }
    btns.forEach(b => b.addEventListener('click', () => setMode(b.dataset.bill)));
    requestAnimationFrame(placeSlide);
    window.addEventListener('resize', placeSlide);
    setTimeout(() => setMode('annual'), 1200 + 900);
    setTimeout(() => setMode('monthly'), 1200 + 900 + 2600);
  }

  /* ============================================================
     TESTIMONIALS — horizontal carousel, drag on touch
     ============================================================ */
  function initQuotes() {
    const track = $('#qTrack'), dotsBox = $('#qDots');
    if (!track) return;
    const slides = $$('.quote', track);
    let i = 0, timer = null, paused = false, visible = false;

    slides.forEach((_, si) => {
      const d = document.createElement('button');
      d.className = 'q-dot' + (si === 0 ? ' on' : '');
      d.setAttribute('role', 'tab');
      d.setAttribute('aria-label', 'Testimonial ' + (si + 1));
      d.addEventListener('click', () => go(si));
      dotsBox.appendChild(d);
    });
    const dots = $$('.q-dot', dotsBox);

    function go(n, userAction) {
      i = (n + slides.length) % slides.length;
      track.style.transform = 'translate3d(-' + (i * 100) + '%,0,0)';
      dots.forEach((d, di) => d.classList.toggle('on', di === i));
      if (userAction) restart();
    }
    function restart() {
      clearInterval(timer);
      if (!REDUCED) timer = setInterval(() => { if (!paused && visible) go(i + 1); }, 6200);
    }
    $('#qPrev') && $('#qPrev').addEventListener('click', () => go(i - 1, true));
    $('#qNext') && $('#qNext').addEventListener('click', () => go(i + 1, true));
    const box = $('#quotes');
    box.addEventListener('pointerenter', () => { paused = true; document.body.dataset.cursorState = canHoverState() ? 'drag' : document.body.dataset.cursorState; });
    box.addEventListener('pointerleave', () => { paused = false; if (canHoverState()) document.body.dataset.cursorState = 'normal'; });
    function canHoverState() { return R.canHover && !REDUCED; }

    // drag / swipe
    let sx = 0, dragging = false;
    box.addEventListener('pointerdown', e => { sx = e.clientX; dragging = true; });
    window.addEventListener('pointerup', e => {
      if (!dragging) return;
      dragging = false;
      const dx = e.clientX - sx;
      if (Math.abs(dx) > 46) go(dx < 0 ? i + 1 : i - 1, true);
      if (canHoverState()) document.body.dataset.cursorState = 'normal';
    });

    const io = new IntersectionObserver(es => es.forEach(e => { visible = e.isIntersecting; }));
    io.observe(box);
    restart();
  }

  /* ============================================================
     FAQ — smooth accordion
     ============================================================ */
  function initFAQ() {
    const qas = $$('.qa');
    qas.forEach(qa => {
      const btn = $('.qa-q', qa);
      btn.addEventListener('click', () => {
        const isOpen = qa.classList.contains('open');
        qas.forEach(o => {
          o.classList.remove('open');
          $('.qa-q', o).setAttribute('aria-expanded', 'false');
        });
        if (!isOpen) {
          qa.classList.add('open');
          btn.setAttribute('aria-expanded', 'true');
        }
      });
    });
  }

  /* ============================================================
     FOOTER — subtle parallax
     ============================================================ */
  function initParallax() {
    const big = $('#footBig');
    if (!big || REDUCED) return;
    const gate = R.gate(big.parentElement, .2);
    Engine.add({
      fn() {
        if (!gate()) return;
        const r = big.getBoundingClientRect();
        const p = clamp((window.innerHeight - r.top) / (window.innerHeight + r.height), 0, 1);
        big.style.transform = 'translate3d(0,' + ((1 - p) * 28).toFixed(1) + 'px,0)';
      }
    });
  }

  R.story = { initStory, initCore, initPreview, initPricing, initQuotes, initFAQ, initParallax, fillTables, LineChart };
})();
