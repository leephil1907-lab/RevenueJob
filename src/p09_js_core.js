/* ============================================================
   REVENUEPILOT — MOTION ENGINE (zero dependencies)
   ------------------------------------------------------------
   Layer 1: primitives + boot + nav
   Layer 2: ambient systems (particle network, atmosphere)
   Everything is rAF-driven, viewport-gated and reduced-motion aware.
   ============================================================ */
(function () {
  'use strict';

  /* ---------- primitives ---------- */
  const $ = (s, c) => (c || document).querySelector(s);
  const $$ = (s, c) => Array.prototype.slice.call((c || document).querySelectorAll(s));
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const easeOutExpo = t => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));
  const easeOutCubic = t => 1 - Math.pow(1 - t, 3);
  const easeInOutCubic = t => (t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const rnd = (a, b) => a + Math.random() * (b - a);
  /* the i18n formatter (p20_js_runtime.js) owns currency; this is only a fallback
     for the window before it loads. Do not shadow RP.money with a function that
     calls RP.money — that recursed infinitely. */
  const money = n => '$' + Math.round(Number(n) || 0).toLocaleString('en-US');
  const compact = n => {
    if (n >= 1e6) return (n / 1e6).toFixed(n % 1e6 === 0 ? 0 : 2) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(n >= 1e4 ? 0 : 1) + 'K';
    return String(Math.round(n));
  };
  const pad = n => (n < 10 ? '0' + n : '' + n);

  const mq = w => window.matchMedia(w);
  const REDUCED = mq('(prefers-reduced-motion: reduce)').matches;
  const COARSE = mq('(pointer: coarse)').matches;
  const MOBILE = mq('(max-width: 900px)').matches || COARSE;
  const canHover = mq('(hover: hover) and (pointer: fine)').matches && !COARSE;
  if (REDUCED) document.documentElement.classList.add('reduced');

  /* ---------- central rAF scheduler: one loop, many subscribers ---------- */
  const Engine = (function () {
    const subs = new Set();
    let running = false;
    function loop(t) {
      subs.forEach(s => {
        if (s.active === false) return;
        if (typeof s.when === 'function' && !s.when()) return;
        s.fn(t);
      });
      requestAnimationFrame(loop);
    }
    return {
      add(s) { subs.add(s); if (!running) { running = true; requestAnimationFrame(loop); } return s; },
      del(s) { subs.delete(s); }
    };
  })();

  /* ---------- viewport gating helper ---------- */
  function gate(el, margin) {
    const m = margin === undefined ? 0.2 : margin;
    let visible = false;
    const io = new IntersectionObserver(es => {
      es.forEach(e => { visible = e.isIntersecting; });
    }, { rootMargin: (m * 100) + '% 0px ' + (m * 100) + '% 0px' });
    if (el) io.observe(el);
    return () => visible;
  }

  /* ---------- reveal system (staggered, mask, cinematic) ---------- */
  const revealables = $$('[data-reveal]');
  const cineTitles = $$('.cine, .kin');
  function revealNow() {
    if (REDUCED) {
      revealables.forEach(el => el.classList.add('in'));
      cineTitles.forEach(el => el.classList.add('in'));
      return;
    }
    const io = new IntersectionObserver((es, obs) => {
      es.forEach(e => {
        if (!e.isIntersecting) return;
        e.target.classList.add('in');
        obs.unobserve(e.target);
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.12 });
    revealables.forEach(el => io.observe(el));
    cineTitles.forEach(el => io.observe(el));
  }

  /* ---------- boot sequence ---------- */
  function boot(onDone) {
    const el = $('#boot'), bar = $('#bootBar'), sub = $('#bootSub');
    const lines = [
      'initialising revenue engine',
      'reading site configuration',
      'loading locale and currency registries',
      'ready — nothing runs until you connect a source'
    ];
    if (REDUCED) { if (el) el.classList.add('done'); onDone(); return; }
    document.body.classList.add('locked');
    let i = 0, p = 0;
    const t = setInterval(() => {
      p = Math.min(100, p + rnd(18, 34));
      if (bar) bar.style.width = p + '%';
      i = Math.min(lines.length - 1, Math.floor(p / 26));
      if (sub) sub.textContent = lines[i];
      if (p >= 100) {
        clearInterval(t);
        setTimeout(() => {
          if (el) el.classList.add('done');
          document.body.classList.remove('locked');
          onDone();
          setTimeout(() => { if (el) el.style.display = 'none'; }, 700);
        }, 320);
      }
    }, 210);
  }

  /* ============================================================
     AMBIENT SYSTEM — particle network
     Slow enough that you don't consciously notice the movement:
     depth-layered points, faint connection lines, occasional
     data pulses travelling the graph.
     ============================================================ */
  const bg = $('#bgCanvas');
  function initParticles() {
    if (!bg || REDUCED) return;
    const ctx = bg.getContext && bg.getContext('2d');
    if (!ctx) return;                 // no 2D context: atmosphere is skipped, page continues
    let w = 0, h = 0, dpr = 1, pts = [], pulses = [], last = 0;

    function resize() {
      dpr = Math.min(window.devicePixelRatio || 1, 1.6);
      w = window.innerWidth;
      h = window.innerHeight;
      // NOTE: never assign .clientWidth/.clientHeight — they are read-only getters
      bg.width = Math.floor(w * dpr);
      bg.height = Math.floor(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      build();
    }

    function build() {
      const density = MOBILE ? 22000 : 15500;
      const n = clamp(Math.round((w * h) / density), MOBILE ? 16 : 30, MOBILE ? 34 : 82);
      pts = [];
      for (let i = 0; i < n; i++) {
        const z = rnd(.28, 1);
        pts.push({
          x: rnd(0, w), y: rnd(0, h), z: z,
          vx: rnd(-.055, .055) * z * (MOBILE ? 1 : 1.25),
          vy: rnd(-.05, .05) * z,
          r: rnd(.6, 1.7) * z + .35,
          hue: Math.random() < .18 ? 'v' : 'c'
        });
      }
      pulses = [];
    }

    function spawnPulse() {
      if (pts.length < 3) return;
      const a = pts[Math.floor(rnd(0, pts.length))];
      let b = pts[Math.floor(rnd(0, pts.length))];
      let guard = 0;
      while (b === a && guard++ < 8) b = pts[Math.floor(rnd(0, pts.length))];
      const d = Math.hypot(b.x - a.x, b.y - a.y);
      if (d > (MOBILE ? 200 : 300) || d < 40) return;
      pulses.push({ a: a, b: b, t: 0, sp: rnd(.004, .0095), life: 1 });
    }

    resize();
    window.addEventListener('resize', () => { clearTimeout(bg._rt); bg._rt = setTimeout(resize, 180); });

    const linkDist = MOBILE ? 108 : 148;
    Engine.add({
      active: true,
      fn(now) {
        if (now - last < 1000 / 40) return;   // 40fps cap — atmospheric motion needs no more
        last = now;
        if (document.hidden) return;
        ctx.clearRect(0, 0, w, h);

        // dots
        for (let i = 0; i < pts.length; i++) {
          const p = pts[i];
          p.x += p.vx; p.y += p.vy;
          if (p.x < -20) p.x = w + 20; else if (p.x > w + 20) p.x = -20;
          if (p.y < -20) p.y = h + 20; else if (p.y > h + 20) p.y = -20;
          ctx.beginPath();
          ctx.fillStyle = p.hue === 'v'
            ? 'rgba(138,107,255,' + (.22 + p.z * .4).toFixed(3) + ')'
            : 'rgba(150,220,255,' + (.18 + p.z * .46).toFixed(3) + ')';
          ctx.arc(p.x, p.y, p.r, 0, 6.284);
          ctx.fill();
        }

        // connection lines
        ctx.lineWidth = .7;
        for (let i = 0; i < pts.length; i++) {
          const a = pts[i];
          for (let j = i + 1; j < pts.length; j++) {
            const b = pts[j];
            const dx = a.x - b.x, dy = a.y - b.y;
            const d2 = dx * dx + dy * dy;
            if (d2 > linkDist * linkDist) continue;
            const d = Math.sqrt(d2);
            const al = (1 - d / linkDist) * .13 * ((a.z + b.z) * .5);
            ctx.strokeStyle = 'rgba(120,190,255,' + al.toFixed(3) + ')';
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
          }
        }

        // data pulses
        if (Math.random() < .022 && pulses.length < (MOBILE ? 2 : 5)) spawnPulse();
        for (let i = pulses.length - 1; i >= 0; i--) {
          const pu = pulses[i];
          pu.t += pu.sp;
          if (pu.t >= 1) { pulses.splice(i, 1); continue; }
          const t = easeInOutCubic(pu.t);
          const x = lerp(pu.a.x, pu.b.x, t), y = lerp(pu.a.y, pu.b.y, t);
          const fade = Math.sin(pu.t * Math.PI);
          // faint trail line
          ctx.strokeStyle = 'rgba(90,231,255,' + (.14 * fade).toFixed(3) + ')';
          ctx.lineWidth = .8;
          ctx.beginPath();
          ctx.moveTo(lerp(pu.a.x, pu.b.x, Math.max(0, t - .12)), lerp(pu.a.y, pu.b.y, Math.max(0, t - .12)));
          ctx.lineTo(x, y);
          ctx.stroke();
          // head
          const g = ctx.createRadialGradient(x, y, 0, x, y, 11);
          g.addColorStop(0, 'rgba(190,245,255,' + (.85 * fade).toFixed(3) + ')');
          g.addColorStop(.4, 'rgba(90,231,255,' + (.34 * fade).toFixed(3) + ')');
          g.addColorStop(1, 'rgba(90,231,255,0)');
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(x, y, 11, 0, 6.284);
          ctx.fill();
        }
      }
    });
  }

  /* ---------- atmospheric light: slow parallax drift on pointer + scroll ---------- */
  function initAtmo() {
    if (REDUCED) return;
    const l1 = $('#atmo1'), l2 = $('#atmo2'), l3 = $('#atmo3');
    if (!l1) return;
    let mx = 0, my = 0, cx = 0, cy = 0, sy = 0, cy2 = 0;
    if (canHover) {
      window.addEventListener('pointermove', e => {
        mx = (e.clientX / window.innerWidth - .5) * 2;
        my = (e.clientY / window.innerHeight - .5) * 2;
      }, { passive: true });
    }
    Engine.add({
      active: true,
      fn() {
        cx = lerp(cx, mx, .035);
        cy = lerp(cy, my, .035);
        const target = window.pageYOffset * .06;
        cy2 = lerp(cy2, target, .06);
        l1.style.transform = 'translate3d(' + (cx * 26) + 'px,' + (cy * 18 - cy2 * .5) + 'px,0)';
        l2.style.transform = 'translate3d(' + (cx * -34) + 'px,' + (cy * -22 + cy2 * .35) + 'px,0)';
        l3.style.transform = 'translate3d(' + (cx * 18) + 'px,' + (cy * 14 - cy2 * .8) + 'px,0)';
      }
    });
  }

  /* ---------- nav: stick, direction-aware hide, active section ---------- */
  function initNav() {
    const nav = $('#nav'), burger = $('#burger'), sheet = $('#navSheet');
    let lastY = window.pageYOffset, queued = false;

    function onScroll() {
      const y = window.pageYOffset;
      if (y > 24) nav.classList.add('stuck'); else nav.classList.remove('stuck');
      if (y > 620 && y > lastY + 6 && !document.body.classList.contains('sheet-open')) {
        nav.classList.add('hide');
      } else if (y < lastY - 6 || y < 620) {
        nav.classList.remove('hide');
      }
      lastY = y;
      queued = false;
    }
    window.addEventListener('scroll', () => {
      if (!queued) { queued = true; requestAnimationFrame(onScroll); }
    }, { passive: true });

    // active section tracking
    const links = $$('.nav-link');
    const map = links.map(a => ({ a: a, sec: $(a.getAttribute('href')) })).filter(o => o.sec);
    const io = new IntersectionObserver(es => {
      es.forEach(e => {
        map.forEach(o => {
          if (o.sec === e.target) o.a.classList.toggle('active', e.isIntersecting);
        });
      });
    }, { rootMargin: '-45% 0px -50% 0px' });
    map.forEach(o => io.observe(o.sec));

    // mobile sheet
    if (burger) {
      burger.addEventListener('click', () => {
        const open = document.body.classList.toggle('sheet-open');
        burger.setAttribute('aria-expanded', open ? 'true' : 'false');
        document.body.classList.toggle('locked', open);
      });
    }
    $$('#navSheet a, #navSheet button').forEach(a => a.addEventListener('click', () => {
      document.body.classList.remove('sheet-open', 'locked');
      if (burger) burger.setAttribute('aria-expanded', 'false');
    }));

    // smooth in-page scroll with header offset
    const NAV_H = 66;
    function scrollToEl(el) {
      const y = el.getBoundingClientRect().top + window.pageYOffset - NAV_H + 2;
      window.scrollTo({ top: Math.max(0, y), behavior: REDUCED ? 'auto' : 'smooth' });
    }
    $$('[data-scroll]').forEach(a => {
      a.addEventListener('click', e => {
        e.preventDefault();
        const sel = a.dataset.target || a.getAttribute('href');
        const el = sel && sel.charAt(0) === '#' ? $(sel) : null;
        if (el) scrollToEl(el);
      });
    });
    $$('.brand').forEach(b => b.addEventListener('click', e => {
      e.preventDefault();
      if (document.body.dataset.view === 'console') { window.App && window.App.route('home'); }
      else window.scrollTo({ top: 0, behavior: REDUCED ? 'auto' : 'smooth' });
    }));
  }

  /* ---------- counters ---------- */
  function runCounter(el) {
    const target = parseFloat(el.dataset.count);
    const pre = el.dataset.prefix || '';
    const suf = el.dataset.suffix || '';
    const comp = el.dataset.compact === '1';
    const dur = el.dataset.dur ? parseInt(el.dataset.dur, 10) : 1500;
    const fmt = v => pre + (comp ? compact(v) : Math.round(v).toLocaleString('en-US')) + suf;
    if (REDUCED) { el.textContent = fmt(target); return; }
    const t0 = performance.now();
    (function step(t) {
      const p = clamp((t - t0) / dur, 0, 1);
      el.textContent = fmt(target * easeOutExpo(p));
      if (p < 1) requestAnimationFrame(step);
      else el.textContent = fmt(target);
    })(t0);
  }
  function initCounters() {
    const els = $$('[data-count]');
    // reduced motion = a complete static experience: values are simply present, never counted up
    if (REDUCED) {
      els.forEach(el => { el.dataset.done = '1'; runCounter(el); });
      return { refresh() { els.forEach(el => runCounter(el)); } };
    }
    const io = new IntersectionObserver((es, obs) => {
      es.forEach(e => {
        if (!e.isIntersecting) return;
        if (e.target.dataset.done !== '1') { e.target.dataset.done = '1'; runCounter(e.target); }
        obs.unobserve(e.target);
      });
    }, { threshold: .35 });
    els.forEach(el => io.observe(el));
    return { refresh() { els.forEach(el => { if (el.dataset.done === '1') runCounter(el); }); } };
  }

  /* ---------- public surface ---------- */
  /* merge, never replace: p20_js_runtime.js runs first and owns RP.cfg, RP.i18n,
     RP.t and RP.money. Assigning a fresh object here silently destroyed them. */
  window.RP = window.RP || {};
  Object.assign(window.RP, {
    $: $, $$: $$, clamp: clamp, lerp: lerp, rnd: rnd,
    easeOutExpo: easeOutExpo, easeOutCubic: easeOutCubic, easeInOutCubic: easeInOutCubic,
    money: (window.RP && window.RP.money) ? window.RP.money : money,
    compact: compact, pad: pad,
    REDUCED: REDUCED, COARSE: COARSE, MOBILE: MOBILE, canHover: canHover,
    Engine: Engine, gate: gate, boot: boot, revealNow: revealNow,
    initParticles: initParticles, initAtmo: initAtmo, initNav: initNav,
    initCounters: initCounters, runCounter: runCounter
  });
})();
