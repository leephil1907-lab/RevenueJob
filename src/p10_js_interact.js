/* ============================================================
   LAYER 3 — interaction intelligence
   cursor states · magnetic hover · 3D tilt · kinetic type
   live agent console · per-card micro motion
   ============================================================ */
(function () {
  'use strict';
  const R = window.RP;
  const { $, $$, clamp, lerp, rnd, pad, Engine, REDUCED, canHover, MOBILE } = R;

  /* ---------- cursor intelligence (desktop only, never blocks a11y) ---------- */
  function initCursor() {
    if (!canHover || REDUCED) return;
    const cur = $('#cursor'), label = $('#curLabel');
    if (!cur) return;
    document.body.classList.add('cur-on');
    let mx = window.innerWidth / 2, my = window.innerHeight / 2;
    let dx = mx, dy = my, rx = mx, ry = my;

    window.addEventListener('pointermove', e => {
      mx = e.clientX; my = e.clientY;
    }, { passive: true });

    Engine.add({
      active: true,
      fn() {
        dx = lerp(dx, mx, .55); dy = lerp(dy, my, .55);
        rx = lerp(rx, mx, .16); ry = lerp(ry, my, .16);
        // ring lags the pointer; the dot rides it exactly. Both are children of the same
        // node, so the dot's transform is the *delta* — never the absolute position.
        cur.style.transform = 'translate3d(' + rx.toFixed(2) + 'px,' + ry.toFixed(2) + 'px,0)';
        const dot = cur.lastElementChild;
        if (dot && dot !== cur.firstElementChild) {
          dot.style.transform = 'translate3d(' + (dx - rx).toFixed(2) + 'px,' + (dy - ry).toFixed(2) + 'px,0)';
        }
      }
    });

    function setState(state, text) {
      document.body.dataset.cursorState = state;
      if (text) label.textContent = text;
    }
    const interactive = 'a,button,input,select,textarea,[data-cursor],.tab,.opt,.qa-q,.tilt';

    document.addEventListener('pointerover', e => {
      const t = e.target.closest(interactive);
      if (!t) { setState('normal'); return; }
      const explicit = t.closest('[data-cursor]');
      if (explicit) {
        const s = explicit.dataset.cursor;
        setState(s, explicit.dataset.cursorLabel || (s === 'play' ? 'PLAY' : s === 'explore' ? 'VIEW' : ''));
      } else {
        setState(t.matches('input,textarea') ? 'text' : 'button');
      }
    }, { passive: true });

    document.addEventListener('pointerdown', () => {
      if (document.body.dataset.cursorState === 'drag') return;
      document.body.dataset.cursorState = 'button';
    }, { passive: true });
  }

  /* ---------- magnetic buttons ---------- */
  function initMagnet() {
    if (!canHover || REDUCED) return;
    $$('.magnet').forEach(btn => {
      let raf = null, tx = 0, ty = 0, cx = 0, cy = 0, animating = false;

      function stop() {
        if (!animating) { tx = 0; ty = 0; }
      }
      btn.addEventListener('pointermove', e => {
        const r = btn.getBoundingClientRect();
        const px = (e.clientX - r.left) / r.width - .5;
        const py = (e.clientY - r.top) / r.height - .5;
        tx = clamp(px * 9, -5.5, 5.5);
        ty = clamp(py * 7, -4, 4);
        if (!animating) {
          animating = true;
          (function run() {
            cx = lerp(cx, tx, .18); cy = lerp(cy, ty, .18);
            btn.style.transform = 'translate3d(' + cx.toFixed(2) + 'px,' + cy.toFixed(2) + 'px,0)';
            raf = requestAnimationFrame(run);
          })();
        }
      });
      btn.addEventListener('pointerleave', () => {
        tx = 0; ty = 0;
        animating = true;
        if (!raf) {
          (function run() {
            cx = lerp(cx, 0, .18); cy = lerp(cy, 0, .18);
            btn.style.transform = 'translate3d(' + cx.toFixed(2) + 'px,' + cy.toFixed(2) + 'px,0)';
            if (Math.abs(cx) < .05 && Math.abs(cy) < .05) {
              btn.style.transform = ''; animating = false; raf = null; return;
            }
            raf = requestAnimationFrame(run);
          })();
        }
      });
    });
  }

  /* ---------- 3D tilt cards ---------- */
  function initTilt() {
    if (!canHover || REDUCED) return;
    $$('.tilt').forEach(card => {
      let raf = null, tX = 0, tY = 0, cX = 0, cY = 0, active = false;
      const MAX = MOBILE ? 2.5 : 5;
      function loop() {
        cX = lerp(cX, tX, .12); cY = lerp(cY, tY, .12);
        card.style.transform = 'perspective(1100px) rotateX(' + cX.toFixed(2) + 'deg) rotateY(' + cY.toFixed(2) + 'deg) translateY(-2px)';
        if (!active && Math.abs(cX) < .04 && Math.abs(cY) < .04) {
          card.style.transform = ''; raf = null; return;
        }
        raf = requestAnimationFrame(loop);
      }
      card.addEventListener('pointermove', e => {
        const r = card.getBoundingClientRect();
        const px = (e.clientX - r.left) / r.width - .5;
        const py = (e.clientY - r.top) / r.height - .5;
        tX = -py * MAX; tY = px * MAX;
        card.style.setProperty('--mx', (px * 100 + 50) + '%');
        card.style.setProperty('--my', (py * 100 + 50) + '%');
        active = true;
        if (!raf) raf = requestAnimationFrame(loop);
      });
      card.addEventListener('pointerleave', () => {
        tX = 0; tY = 0; active = false;
        if (!raf) raf = requestAnimationFrame(loop);
      });
    });
  }

  /* ---------- kinetic typography ---------- */
  function initKinetic() {
    const el = $('#kinetic');
    if (!el) return;
    const words = el.textContent.trim().split(/\s+/);
    el.textContent = '';
    words.forEach((word, wi) => {
      const w = document.createElement('span');
      w.className = 'kin-word';
      for (let i = 0; i < word.length; i++) {
        const s = document.createElement('span');
        s.textContent = word[i];
        s.style.transitionDelay = (i * 26) + 'ms';
        w.appendChild(s);
      }
      el.appendChild(w);
      if (wi < words.length - 1) el.appendChild(document.createTextNode(' '));
    });
    if (REDUCED) return;
    el.addEventListener('pointermove', e => {
      const w = e.target.closest('.kin-word');
      if (!w) return;
      const r = w.getBoundingClientRect();
      const rel = clamp((e.clientX - r.left) / r.width, 0, 1);
      $$('span', w).forEach((s, i) => {
        const dist = Math.abs(i / Math.max(1, w.children.length - 1) - rel);
        s.style.transform = 'translateY(' + (-6 * (1 - dist * 1.6)).toFixed(1) + 'px) scale(' + (1 + .04 * (1 - dist * 1.6)).toFixed(3) + ')';
        s.style.color = dist < .35 ? 'var(--cy)' : '';
      });
    });
    el.addEventListener('pointerleave', () => {
      $$('.kin-word span', el).forEach(s => { s.style.transform = ''; s.style.color = ''; });
    });
  }

  /* ---------- hero: the AI is visibly working ---------- */

  /* ------------------------------------------------------------
     HERO: the pipeline model, not a simulation
     ------------------------------------------------------------
     This used to run a fake console — invented prospect cards carrying named
     accounts, a revenue counter climbing on a timer, and fake millisecond
     traces. All of it is gone. What remains reacts to the visitor:
     the orb read-out reports the model they entered, and states plainly that
     nothing is connected yet.
     ------------------------------------------------------------ */
  function initHero() {
    const orbModel = $('#orbModel');
    const orbAgents = $('#orbAgents');
    const badge = $('#orbBadgeText');

    function paint() {
      const model = (window.RP.calc && window.RP.calc.model()) || null;
      const has = !!(model && model.hasInput);
      if (orbModel) {
        orbModel.textContent = has
          ? window.RP.money(model.expected) + ' / mo'
          : 'Awaiting your inputs';
      }
      if (orbAgents) {
        const agents = ((window.RP.cfg.capabilities || {}).agents || []).length;
        orbAgents.innerHTML = '<span>' + window.RP.num(agents) + ' agent roles</span>';
      }
      document.querySelectorAll('[data-out="expected"]').forEach(el => {
        const v = el.getAttribute('data-count');
        if (v !== null) el.setAttribute('data-count', has ? String(Math.round(model.expected)) : '0');
      });
    }
    paint();
    if (window.RP.calc && window.RP.calc.on) window.RP.calc.on(paint);
    window.RP.i18n.on(paint);

    /* the badge reports which renderer is live — wire-verified in test_orb.js */
    if (badge && /Initialising/.test(badge.textContent)) badge.textContent = 'Lite renderer';
  }

  /* ---------- feature cards: each owns a micro motion system ---------- */
  function initMinis() {
    // prospecting: prospect nodes appearing on a faint map
    const nm = $('#nodeMap');
    if (nm) {
      const n = MOBILE ? 9 : 16;
      let svg = '';
      for (let i = 0; i < n; i++) {
        const a = (i * 2.399) % 6.283, r = 12 + (i % 5) * 7;
        const x = 50 + Math.cos(a) * r, y = 50 + Math.sin(a) * r;
        svg += '<path d="M50 50 Q ' + x + ' ' + y + ' ' + (x + 12) + ' ' + (y + 6) + '" style="animation-delay:' + (i * -.7) + 's"/>';
      }
      nm.innerHTML = '<svg viewBox="0 0 100 100" preserveAspectRatio="none">' + svg + '</svg>' +
        Array.from({ length: n }).map((_, i) => {
          const a = (i * 2.399) % 6.283, r = 12 + (i % 5) * 7;
          const x = 50 + Math.cos(a) * r, y = 50 + Math.sin(a) * r;
          return '<i style="left:' + clamp(x, 6, 94) + '%;top:' + clamp(y, 10, 90) + '%;animation-delay:' + (i * -.42) + 's"></i>';
        }).join('');
    }

    // qualification bands: revealed once, no score is invented
    $$('[data-mini="score"]').forEach(c => {
      const io = new IntersectionObserver(es => es.forEach(e => {
        if (e.isIntersecting) c.classList.add('on');
      }), { threshold: .35 });
      io.observe(c);
    });

    // attribution chart: draw on entry
    $$('[data-mini="chart"]').forEach(c => {
      const io = new IntersectionObserver(es => es.forEach(e => {
        if (e.isIntersecting) $('.mini-chart', c).classList.add('on');
      }), { threshold: .4 });
      io.observe(c);
    });

    // chat bubbles restart when scrolled into view (keeps the demo legible)
    $$('[data-mini="chat"]').forEach(c => {
      const io = new IntersectionObserver(es => es.forEach(e => {
        if (e.isIntersecting) $('.mini-chat', c).classList.add('live');
      }), { threshold: .4 });
      io.observe(c);
    });
  }

  /* ---------- sparse "pulse" ticks for atmosphere ---------- */
  function initPulses() {
    if (REDUCED) return;
    const io = new IntersectionObserver(es => {
      es.forEach(e => {
        const k = e.target.dataset.kpi;
        if (k !== '1' || !e.isIntersecting) return;
        const num = $('[data-count]', e.target);
        if (!num) return;
        setTimeout(() => { num.style.transition = 'transform .4s var(--e-out)'; num.style.transform = 'translateY(-2px)'; setTimeout(() => num.style.transform = '', 420); }, rnd(200, 2000));
      });
    }, { threshold: .3 });
    $$('.kpi').forEach(k => io.observe(k));
  }

  R.interact = { initCursor, initMagnet, initTilt, initKinetic, initHero, initMinis, initPulses };
})();
