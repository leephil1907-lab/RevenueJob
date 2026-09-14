/* ============================================================
   ORB ENGINE — the hero as a living revenue machine
   ------------------------------------------------------------
   Layered so the hero never blocks and never breaks:
     1. lite renderer  — 2D canvas, zero dependencies, paints instantly
     2. webgl renderer — Three.js, lazy-loaded from CDN when the
                         browser is idle and WebGL + bandwidth allow
   Both render the same model, so the hero is identical in intent:
     Prospects → Intelligence → Conversations → Opportunities → Revenue
   ============================================================ */
window.OrbEngine = (function () {
  'use strict';

  const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const COARSE = window.matchMedia('(pointer: coarse)').matches;
  const SMALL = window.innerWidth < 900;
  const SAVE_DATA = !!(navigator.connection && navigator.connection.saveData);

  /* stage rings, outer → inner */
  const STAGES = [
    { key: 'Prospects', r: 5.55, hex: '#6fa8ff', rgb: [111, 168, 255], count: 210 },
    { key: 'Intelligence', r: 4.80, hex: '#8a6bff', rgb: [138, 107, 255], count: 170 },
    { key: 'Conversations', r: 4.05, hex: '#5ae7ff', rgb: [90, 231, 255], count: 150 },
    { key: 'Opportunities', r: 3.30, hex: '#46e3a4', rgb: [70, 227, 164], count: 120 },
    { key: 'Revenue', r: 2.55, hex: '#eafcff', rgb: [234, 252, 255], count: 90 }
  ];
  const CORE_R = 1.25;
  const REV_R = 6.35;   // where prospects enter the system

  const CDN = [
    'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js',
    'https://unpkg.com/three@0.149.0/build/three.min.js',
    'https://cdn.jsdelivr.net/npm/three@0.149.0/build/three.min.js'
  ];

  const S = {
    engine: 'none',
    stage: null, mount: null, badge: null, badgeText: null,
    liteCanvas: null, gl: null, running: false, visible: true,
    pointer: { x: 0, y: 0, tx: 0, ty: 0 },
    scroll: 0, t: 0, ring: [], pulses: [], core: 0, spawned: 0,
    chords: [], stats: { pulses: 0, chords: 0, hops: 0 }
  };

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const rnd = (a, b) => a + Math.random() * (b - a);

  /* ---------------------------------------------------------
     LITE RENDERER (2D canvas) — always available
     --------------------------------------------------------- */
  function startLite() {
    const c = document.createElement('canvas');
    c.className = 'lite';
    S.liteCanvas = c;
    S.mount.appendChild(c);
    const ctx = c.getContext && c.getContext('2d');
    if (!ctx) {
      /* no 2D canvas available: take the empty element back out so the inline SVG
         poster is what the visitor sees, not a blank box */
      if (c.parentNode) c.parentNode.removeChild(c);
      S.liteCanvas = null;
      return null;
    }
    let w = 0, h = 0, dpr = 1;
    let pts = [], ringPts = [];

    function size() {
      dpr = Math.min(window.devicePixelRatio || 1, 1.75);
      w = S.mount.clientWidth || 520;
      h = S.mount.clientHeight || 520;
      c.width = Math.floor(w * dpr); c.height = Math.floor(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      build();
    }
    function build() {
      const cx = w / 2, cy = h / 2;
      const scale = Math.min(w, h) / 15.2;
      pts = [];
      const n = SMALL ? 90 : 170;
      for (let i = 0; i < n; i++) {
        const a = rnd(0, 6.283), r = rnd(6.2, 8.0);
        pts.push({ a: a, r: r, s: rnd(.5, 1.5), v: rnd(.02, .07) });
      }
      // connections between adjacent pipeline stages — data visibly moving
      // Prospects → Intelligence → Conversations → Opportunities → Revenue
      const pairs = [[0, 1], [1, 2], [2, 3], [3, 4]];
      const perPair = SMALL ? 4 : 7;
      S.chords = [];
      pairs.forEach((pr, pi) => {
        for (let i = 0; i < perPair; i++) {
          const a = (i / perPair) * 6.283 + pi * .55;
          S.chords.push({ i: pr[0], o: pr[1], a: a, a2: a + .3, t: Math.random(), sp: rnd(.0035, .0085) });
        }
      });
      S.stats.chords = S.chords.length;

      ringPts = STAGES.map(st => {
        const out = [];
        const count = SMALL ? Math.round(st.count * .4) : Math.round(st.count * .7);
        for (let i = 0; i < count; i++) {
          out.push({ a: (i / count) * 6.283 + rnd(-.02, .02), r: st.r + rnd(-.05, .05), s: rnd(.5, 1.3) });
        }
        return out;
      });
      S.lite = { cx: cx, cy: cy, scale: scale };
      size._ready = true;
    }

    S.lite = { cx: 0, cy: 0, scale: 34 };
    size();

    function project(a, r, cx, cy, scale, squash, rot) {
      const ang = a + rot;
      const x = Math.cos(ang) * r * scale;
      const y = Math.sin(ang) * r * scale * squash;
      // depth from the ring's own rotation: front half (sin>0) is brighter
      return { x: cx + x, y: cy + y * .92, depth: (Math.sin(ang) + 1) / 2 };
    }

    function draw(dt, time) {
      const { cx, cy, scale } = S.lite;
      const rot = time * .000035 + S.pointer.x * .22;
      const squash = .42 + Math.abs(S.pointer.y) * .1;
      ctx.clearRect(0, 0, w, h);

      // ambient nodes drifting in the outer shell
      ctx.save();
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        p.a += p.v * .006 * (dt / 16);
        const pr = project(p.a, p.r, cx, cy, scale, squash, rot * .4);
        ctx.globalAlpha = .1 + pr.depth * .32;
        ctx.fillStyle = 'rgba(150,205,255,1)';
        ctx.beginPath();
        ctx.arc(pr.x, pr.y, p.s, 0, 6.283);
        ctx.fill();
      }
      ctx.restore();

      // stage rings: faint arcs + their nodes
      STAGES.forEach((st, i) => {
        const flash = S.ring[i] || 0;
        const zoom = 1 + S.scroll * .06 * (STAGES.length - i);
        ctx.save();
        // arc
        ctx.beginPath();
        ctx.ellipse(cx, cy, st.r * scale * zoom, st.r * scale * squash * zoom, 0, 0, 6.283);
        ctx.strokeStyle = 'rgba(' + st.rgb.join(',') + ',' + (.1 + flash * .5).toFixed(3) + ')';
        ctx.lineWidth = 1 + flash * 1.6;
        ctx.stroke();
        // nodes
        const arr = ringPts[i] || [];
        for (let k = 0; k < arr.length; k++) {
          const o = arr[k];
          const pr = project(o.a, o.r * zoom, cx, cy, scale, squash, rot);
          const a = (.06 + pr.depth * .34) + flash * .4;
          ctx.globalAlpha = Math.min(1, a);
          ctx.fillStyle = st.hex;
          ctx.beginPath();
          ctx.arc(pr.x, pr.y, o.s * (1 + flash * .8), 0, 6.283);
          ctx.fill();
        }
        ctx.restore();
      });

      // connections between stages: faint links with a data pulse riding each one
      ctx.save();
      S.linkFlash = S.linkFlash || {};
      for (let ci = 0; ci < S.chords.length; ci++) {
        const ch = S.chords[ci];
        const outer = STAGES[ch.i], inner = STAGES[ch.o];
        const zoomO = 1 + S.scroll * .06 * (STAGES.length - ch.i);
        const zoomI = 1 + S.scroll * .06 * (STAGES.length - ch.o);
        const p1 = project(ch.a, outer.r * zoomO, cx, cy, scale, squash, rot);
        const p2 = project(ch.a2, inner.r * zoomI, cx, cy, scale, squash, rot);
        const fc = S.linkFlash[ci] || 0;
        ctx.globalAlpha = .15 + fc * .5;
        ctx.strokeStyle = 'rgba(120,190,255,1)';
        ctx.lineWidth = .8;
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.stroke();

        ch.t += ch.sp * (dt / 16);
        if (ch.t >= 1) {
          ch.t = 0;
          S.linkFlash[ci] = 1;
          S.stats.pulses++;
          // it doesn't stop at the ring — it keeps converging on the core
          S.pulses.push({ a: ch.a2, r0: inner.r, t: 0, sp: rnd(.0032, .0052), dir: 'in' });
          if (S.pulses.length > 15) S.pulses.shift();
        }
        const e = Math.pow(ch.t, .9);
        ctx.globalAlpha = .5 + fc * .4;
        ctx.fillStyle = 'rgba(215,245,255,1)';
        ctx.beginPath();
        ctx.arc(lerp(p1.x, p2.x, e), lerp(p1.y, p2.y, e), 1.5, 0, 6.283);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      for (const k in S.linkFlash) S.linkFlash[k] = Math.max(0, S.linkFlash[k] * .93);
      ctx.restore();

      // data pulses: travel inward, flashing each ring they cross
      ctx.save();
      for (let i = S.pulses.length - 1; i >= 0; i--) {
        const p = S.pulses[i];
        p.t += p.sp * (dt / 16);
        if (p.t >= 1) { S.pulses.splice(i, 1); S.core = 1; continue; }
        const ease = Math.pow(p.t, .82);
        const from = p.r0 || REV_R;
        const r = p.dir === 'out' ? lerp(CORE_R, REV_R, ease) : lerp(from, CORE_R, ease);
        const pr = project(p.a, r, cx, cy, scale, squash, rot);
        const fade = Math.sin(Math.min(1, p.t * 1.15) * Math.PI * .9) * .9 + .1;
        // glow
        const g = ctx.createRadialGradient(pr.x, pr.y, 0, pr.x, pr.y, 12);
        g.addColorStop(0, 'rgba(200,245,255,' + (.8 * fade).toFixed(3) + ')');
        g.addColorStop(.35, 'rgba(' + (p.dir === 'out' ? '70,227,164' : '90,231,255') + ',' + (.35 * fade).toFixed(3) + ')');
        g.addColorStop(1, 'rgba(90,231,255,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(pr.x, pr.y, 12, 0, 6.283);
        ctx.fill();
        ctx.fillStyle = p.dir === 'out' ? 'rgba(198,247,228,1)' : 'rgba(240,253,255,1)';
        ctx.beginPath();
        ctx.arc(pr.x, pr.y, 1.9, 0, 6.283);
        ctx.fill();
        // ring crossing flash
        STAGES.forEach((st, si) => {
          const d = Math.abs(r - st.r);
          if (d < .11) S.ring[si] = Math.max(S.ring[si] || 0, 1 - d / .11);
        });
        // a qualified-lead pulse travelling back out to revenue
        if (p.t > .55 && p.dir === 'in' && Math.random() < .004 && S.pulses.length < 14) {
          S.pulses.push({ a: p.a + rnd(-.5, .5), t: 0, sp: p.sp * .8, dir: 'out' });
        }
      }
      ctx.restore();

      // ring decay
      for (let i = 0; i < S.ring.length; i++) S.ring[i] = Math.max(0, (S.ring[i] || 0) * .93);
      S.core = Math.max(0, S.core * .9);

      // core: translucent sphere + pulse
      const cr = CORE_R * scale * (1 + S.scroll * .28) * (1 + S.core * .1);
      const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, cr * 2.9);
      glow.addColorStop(0, 'rgba(228,250,255,' + (.5 + S.core * .35).toFixed(3) + ')');
      glow.addColorStop(.22, 'rgba(90,231,255,' + (.23 + S.core * .2).toFixed(3) + ')');
      glow.addColorStop(.55, 'rgba(99,102,241,.11)');
      glow.addColorStop(1, 'rgba(90,231,255,0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(cx, cy, cr * 2.9, 0, 6.283);
      ctx.fill();

      // core mesh illusion: a few rotating ellipses
      for (let i = 0; i < 3; i++) {
        const rr = cr * (.72 + i * .16);
        const sq = .34 + i * .16;
        const rr2 = time * .0004 * (i % 2 ? -1 : 1);
        ctx.beginPath();
        ctx.ellipse(cx, cy, rr, rr * sq, rr2, 0, 6.283);
        ctx.strokeStyle = 'rgba(190,240,255,' + (.16 - i * .035 + S.core * .2).toFixed(3) + ')';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(240,253,255,' + (.5 + S.core * .4).toFixed(3) + ')';
      ctx.beginPath();
      ctx.arc(cx, cy, 2.1 + S.core * 2.4, 0, 6.283);
      ctx.fill();
    }

    /* The five stage labels form a HUD around the orb: a fixed vertical ladder
       per column, alternating sides, so they never collide and never depend on
       the projection (they stay readable while the rings turn). */
    const labelEls = document.querySelectorAll('.orb-label');
    const LABEL_Y_LEFT = [30, 46, 62];
    const LABEL_Y_RIGHT = [38, 54];
    function positionLabelsLite() {
      if (!labelEls.length) return;
      let li = 0, ri = 0;
      STAGES.forEach((st, i) => {
        const el = labelEls[i];
        if (!el) return;
        const left = i % 2 === 0;
        const y = left ? LABEL_Y_LEFT[li++ % LABEL_Y_LEFT.length] : LABEL_Y_RIGHT[ri++ % LABEL_Y_RIGHT.length];
        el.style.left = left ? '2.5%' : '49%';
        el.style.right = 'auto';
        el.style.top = y + '%';
        el.classList.toggle('on', (S.ring[i] || 0) > .25);
      });
    }

    let last = performance.now();
    function loop(now) {
      if (!S.running || S.liteOff) return;   // stops once the WebGL renderer takes over
      const dt = Math.min(48, now - last); last = now;
      if (S.visible && !document.hidden) {
        draw(dt, now);
        positionLabelsLite();
        spawnTick(dt);
      }
      requestAnimationFrame(loop);
    }

    window.addEventListener('resize', () => { clearTimeout(c._rt); c._rt = setTimeout(size, 180); });
    S.engine = 'lite';
    S.running = true;
    if (REDUCED) { draw(16, 0); positionLabelsLite(); } else requestAnimationFrame(loop);
    return { canvas: c, ctx: ctx };   // explicit handle: callers must not infer success
  }

  /* shared spawn logic (lite + gl use the same pulses) */
  let spawnAcc = 0;
  function spawnTick(dt) {
    if (REDUCED) return;
    spawnAcc += dt;
    const interval = S.pulses.length > 9 ? 1400 : 620;
    if (spawnAcc > interval) {
      spawnAcc = 0;
      const st = STAGES[Math.floor(rnd(0, STAGES.length))];
      S.pulses.push({ a: st.r + rnd(-.4, .4) * 3, t: 0, sp: rnd(.0022, .0041), dir: Math.random() < .3 ? 'out' : 'in' });
      if (S.pulses.length > 13) S.pulses.shift();
    }
  }

  /* ---------------------------------------------------------
     WEBGL RENDERER (Three.js, lazy)
     --------------------------------------------------------- */
  function loadThree(done, fail) {
    const cands = CDN.slice();
    (function next() {
      if (!cands.length) { fail('no source'); return; }
      const src = cands.shift();
      const s = document.createElement('script');
      let settled = false;
      const to = setTimeout(() => { if (!settled) { settled = true; s.remove(); next(); } }, 7000);
      s.src = src; s.async = true;
      s.onload = () => {
        clearTimeout(to);
        if (settled) return; settled = true;
        if (window.THREE) done(window.THREE); else next();
      };
      s.onerror = () => { clearTimeout(to); if (!settled) { settled = true; next(); } };
      document.head.appendChild(s);
    })();
  }

  function webglAvailable() {
    try {
      const c = document.createElement('canvas');
      return !!(window.WebGLRenderingContext && (c.getContext('webgl') || c.getContext('experimental-webgl')));
    } catch (e) { return false; }
  }

  function softDot(THREE, size) {
    const cv = document.createElement('canvas');
    cv.width = cv.height = size;
    const g = cv.getContext('2d');
    const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(.35, 'var(--t-550)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.fillRect(0, 0, size, size);
    return new THREE.CanvasTexture(cv);
  }

  function startGL(THREE) {
    const mount = S.mount;
    const canvas = document.createElement('canvas');
    canvas.className = 'gl';
    canvas.style.opacity = '0';
    canvas.style.transition = 'opacity .9s ease';
    mount.appendChild(canvas);

    let renderer, scene, camera, group, coreGroup, coreMesh, coreSprite, dots, links, pulses = [];
    let w = mount.clientWidth || 520, h = mount.clientHeight || 520;
    const clock = new THREE.Clock();
    const MOBILE = SMALL || COARSE;

    try {
      renderer = new THREE.WebGLRenderer({
        canvas: canvas, alpha: true, antialias: !MOBILE, powerPreference: 'high-performance'
      });
    } catch (e) { canvas.remove(); throw e; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MOBILE ? 1.25 : 1.6));
    renderer.setSize(w, h, false);
    renderer.setClearColor(0x000000, 0);

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(46, w / h, .1, 100);
    camera.position.set(0, 1.5, 12.4);
    camera.lookAt(0, 0, 0);

    group = new THREE.Group();
    scene.add(group);

    const dotTex = softDot(THREE, 64);

    /* --- ambient node field: thousands of subtle particles --- */
    const SHELL_N = MOBILE ? 900 : 2400;
    const pos = new Float32Array(SHELL_N * 3);
    const col = new Float32Array(SHELL_N * 3);
    for (let i = 0; i < SHELL_N; i++) {
      const u = Math.random(), v = Math.random();
      const theta = 2 * Math.PI * u, phi = Math.acos(2 * v - 1);
      const r = rnd(6.0, 8.2);
      const x = r * Math.sin(phi) * Math.cos(theta);
      const y = r * Math.sin(phi) * Math.sin(theta) * .78;
      const z = r * Math.cos(phi);
      pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
      const c = Math.random() < .22 ? [.54, .42, 1] : [.42, .78, 1];
      const k = rnd(.5, 1);
      col[i * 3] = c[0] * k; col[i * 3 + 1] = c[1] * k; col[i * 3 + 2] = c[2] * k;
    }
    const shellGeo = new THREE.BufferGeometry();
    shellGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    shellGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    dots = new THREE.Points(shellGeo, new THREE.PointsMaterial({
      size: MOBILE ? .16 : .13, map: dotTex, vertexColors: true, transparent: true, opacity: .72,
      depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true
    }));
    group.add(dots);

    /* --- animated data connections between nearby nodes --- */
    const segs = [];
    const limit = MOBILE ? 190 : 520;
    for (let i = 0; i < SHELL_N && segs.length < limit * 2; i += 3) {
      const j = i + 3 + Math.floor(Math.random() * 24);
      if (j >= SHELL_N) continue;
      const xi = pos[i * 3], yi = pos[i * 3 + 1], zi = pos[i * 3 + 2];
      const xj = pos[j * 3], yj = pos[j * 3 + 1], zj = pos[j * 3 + 2];
      const d = Math.hypot(xi - xj, yi - yj, zi - zj);
      if (d > 1.5) continue;
      segs.push(xi, yi, zi, xj, yj, zj);
    }
    // flat segment list → explicit edges so a pulse can ride the graph
    const edgeList = [];
    for (let i = 0; i < segs.length; i += 6) {
      edgeList.push({ ax: segs[i], ay: segs[i + 1], az: segs[i + 2], bx: segs[i + 3], by: segs[i + 4], bz: segs[i + 5] });
    }
    const linkGeo = new THREE.BufferGeometry();
    linkGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(segs), 3));
    links = new THREE.LineSegments(linkGeo, new THREE.LineBasicMaterial({
      color: 0x5ae7ff, transparent: true, opacity: .1, blending: THREE.AdditiveBlending, depthWrite: false
    }));
    group.add(links);

    /* --- stage rings --- */
    const rings = STAGES.map((st, i) => {
      const n = MOBILE ? Math.round(st.count * .5) : st.count;
      const rp = new Float32Array(n * 3);
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2;
        const r = st.r + rnd(-.04, .04);
        rp[k * 3] = Math.cos(a) * r;
        rp[k * 3 + 1] = Math.sin(a) * r;
        rp[k * 3 + 2] = rnd(-.05, .05);
      }
      const gg = new THREE.BufferGeometry();
      gg.setAttribute('position', new THREE.BufferAttribute(rp, 3));
      const m = new THREE.PointsMaterial({
        size: .085, map: dotTex, color: new THREE.Color(st.hex), transparent: true, opacity: .5,
        depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true
      });
      const pts3 = new THREE.Points(gg, m);
      pts3.rotation.x = i % 2 ? .14 : -.1;
      group.add(pts3);
      // a thin continuous line for the ring itself
      const ringLine = new THREE.LineLoop(gg.clone(), new THREE.LineBasicMaterial({
        color: new THREE.Color(st.hex), transparent: true, opacity: .12,
        blending: THREE.AdditiveBlending, depthWrite: false
      }));
      ringLine.rotation.copy(pts3.rotation);
      group.add(ringLine);
      return { mesh: pts3, line: ringLine, mat: m, st: st, flash: 0, baseOp: .5 };
    });

    /* --- core: translucent sphere, wireframe shell, glow --- */
    coreGroup = new THREE.Group();
    group.add(coreGroup);
    coreMesh = new THREE.Mesh(
      new THREE.IcosahedronGeometry(1.05, 2),
      new THREE.MeshBasicMaterial({ color: 0x5ae7ff, wireframe: true, transparent: true, opacity: .2, blending: THREE.AdditiveBlending })
    );
    coreGroup.add(coreMesh);
    const innerMesh = new THREE.Mesh(
      new THREE.SphereGeometry(.92, 24, 18),
      new THREE.MeshBasicMaterial({ color: 0x1b3a63, transparent: true, opacity: .4 })
    );
    coreGroup.add(innerMesh);
    const coreGlow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: softDot(THREE, 256), color: 0x6fd6ff, transparent: true, opacity: .55,
      blending: THREE.AdditiveBlending, depthWrite: false
    }));
    coreGlow.scale.set(6.2, 6.2, 1);
    coreGroup.add(coreGlow);
    coreSprite = coreGlow;
    for (let i = 0; i < 3; i++) {
      const t = new THREE.Mesh(
        new THREE.TorusGeometry(1.5 + i * .28, .006, 8, 90),
        new THREE.MeshBasicMaterial({ color: i === 1 ? 0x8a6bff : 0x5ae7ff, transparent: true, opacity: .28 - i * .06, blending: THREE.AdditiveBlending })
      );
      t.rotation.x = 1.1 + i * .5; t.rotation.y = .4 * i;
      coreGroup.add(t);
    }

    /* --- pulses riding the connection graph (data moving through the system) --- */
    const rideGeo = new THREE.SphereGeometry(.032, 6, 6);
    const LINK_MAX = MOBILE ? 8 : 18;
    const linkPulses = [];
    const linkPool = [];
    function linkMesh() {
      const m = linkPool.pop() || new THREE.Mesh(rideGeo, new THREE.MeshBasicMaterial({
        color: 0x8fe4ff, transparent: true, opacity: .85, blending: THREE.AdditiveBlending
      }));
      m.visible = true;
      group.add(m);
      return m;
    }
    function releaseMesh(m) { m.visible = false; group.remove(m); linkPool.push(m); }
    function edgePoint(e, t) {
      return { x: e.ax + (e.bx - e.ax) * t, y: e.ay + (e.by - e.ay) * t, z: e.az + (e.bz - e.az) * t };
    }
    function nearestEdge(p, skip) {
      let best = -1, bd = 1e9, fromA = true;
      for (let i = 0; i < edgeList.length; i++) {
        if (i === skip) continue;
        const e = edgeList[i];
        const da = Math.hypot(e.ax - p.x, e.ay - p.y, e.az - p.z);
        const db = Math.hypot(e.bx - p.x, e.by - p.y, e.bz - p.z);
        const d = Math.min(da, db);
        if (d < bd) { bd = d; best = i; fromA = da <= db; }
      }
      return bd < 1.25 ? { i: best, fromA: fromA } : null;
    }
    function spawnLink() {
      if (linkPulses.length >= LINK_MAX || !edgeList.length) return;
      const e = Math.floor(Math.random() * edgeList.length);
      linkPulses.push({ mesh: linkMesh(), edge: e, t: 0, sp: rnd(.006, .014), hops: 1 + Math.floor(Math.random() * 3), rev: false });
    }

    /* --- travelling pulses (prospects entering, converging on the core) --- */
    const pulseGeo = new THREE.SphereGeometry(.055, 8, 8);
    function spawn3D() {
      const dir = Math.random() < .3 ? 'out' : 'in';
      const m = new THREE.Mesh(pulseGeo, new THREE.MeshBasicMaterial({
        color: dir === 'out' ? 0x46e3a4 : 0x9ff2ff, transparent: true, opacity: .95, blending: THREE.AdditiveBlending
      }));
      group.add(m);
      pulses.push({ m: m, a: rnd(0, Math.PI * 2), spin: rnd(-.5, .5), t: 0, sp: rnd(.0035, .0062), dir: dir });
      // trailing sprite for glow
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({
        map: dotTex, color: dir === 'out' ? 0x46e3a4 : 0x5ae7ff, transparent: true, opacity: .5,
        blending: THREE.AdditiveBlending, depthWrite: false
      }));
      sp.scale.set(.9, .9, 1);
      m.add(sp);
      return m;
    }
    for (let i = 0; i < (MOBILE ? 5 : 9); i++) { const m = spawn3D(); m.userData.phase = Math.random(); }

    /* --- resize + gates --- */
    function resize() {
      w = mount.clientWidth || 520; h = mount.clientHeight || 520;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
    window.addEventListener('resize', () => { clearTimeout(canvas._rt); canvas._rt = setTimeout(resize, 180); });

    const io = new IntersectionObserver(es => { es.forEach(e => { S.visible = e.isIntersecting; }); }, { threshold: 0 });
    io.observe(mount);

    /* --- render loop --- */
    let spawnT = 0, last = performance.now();
    function frame(now) {
      if (!S.running) return;
      const dt = Math.min(48, now - last); last = now;
      if (!S.visible || document.hidden) { requestAnimationFrame(frame); return; }
      const time = now;
      clock.getDelta();

      // pointer damping (desktop) / autonomous drift (mobile)
      S.pointer.x = lerp(S.pointer.x, S.pointer.tx, .05);
      S.pointer.y = lerp(S.pointer.y, S.pointer.ty, .05);
      const drift = MOBILE ? Math.sin(time * .00016) * .5 : 0;

      group.rotation.y += .00055 * (dt / 16) + (S.pointer.x * .0022) + drift * .0016;
      group.rotation.x = lerp(group.rotation.x, S.pointer.y * .22, .06);
      group.rotation.z = lerp(group.rotation.z, S.scroll * .34, .05);

      // scroll: the camera pushes through the system
      camera.position.y = lerp(camera.position.y, 1.5 + S.scroll * 2.4, .06);
      camera.position.z = lerp(camera.position.z, 12.4 - S.scroll * 2.8, .06);
      camera.lookAt(0, S.scroll * .4, 0);

      // ring breathing + flash decay
      rings.forEach((r, i) => {
        r.flash = Math.max(0, r.flash * .94);
        r.mat.opacity = r.baseOp + r.flash * .5 + Math.sin(time * .0004 + i) * .05;
        r.mesh.rotation.z += .00022 * (dt / 16) * (i % 2 ? -1 : 1);
        r.line.rotation.z = r.mesh.rotation.z;
        r.line.material.opacity = .1 + r.flash * .5;
        const s = 1 + S.scroll * .05 * (STAGES.length - i);
        r.mesh.scale.setScalar(s); r.line.scale.setScalar(s);
      });

      // core
      coreGroup.rotation.y += .0022 * (dt / 16);
      coreGroup.rotation.x += .0007 * (dt / 16);
      S.core = Math.max(0, S.core * .92);
      const cs = (1 + S.scroll * .26) * (1 + S.core * .12);
      coreGroup.scale.setScalar(cs);
      coreSprite.material.opacity = .45 + S.core * .4 + Math.sin(time * .0011) * .07;
      coreMesh.material.opacity = .18 + S.core * .3;
      coreMesh.rotation.y -= .003 * (dt / 16);

      // links shimmer: "data moving through the system"
      links.material.opacity = .07 + Math.sin(time * .0009) * .035 + S.core * .12;

      // graph pulses: data hopping across the connections toward the core
      if (linkPulses.length < LINK_MAX && Math.random() < .06) spawnLink();
      for (let i = linkPulses.length - 1; i >= 0; i--) {
        const lp = linkPulses[i];
        const e = edgeList[lp.edge];
        if (!e) { releaseMesh(lp.mesh); linkPulses.splice(i, 1); continue; }
        lp.t += lp.sp * (dt / 16);
        const p = edgePoint(e, lp.rev ? 1 - lp.t : lp.t);
        lp.mesh.position.set(p.x, p.y, p.z);
        if (lp.t >= 1) {
          const hop = lp.hops > 0 ? nearestEdge(p, lp.edge) : null;
          if (hop) {
            lp.edge = hop.i; lp.t = 0; lp.rev = !hop.fromA; lp.hops--;
            S.stats.hops++;
          } else {
            if (Math.hypot(p.x, p.y, p.z) < 3.2) { S.core = Math.min(1, S.core + .5); S.stats.pulses++; }
            releaseMesh(lp.mesh);
            linkPulses.splice(i, 1);
          }
        }
      }

      // pulses: prospects entering, converging on the core
      spawnT += dt;
      if (spawnT > (pulses.length > 11 ? 1500 : 650)) {
        spawnT = 0;
        spawn3D();
        if (pulses.length > 13) { const old = pulses.shift(); group.remove(old.m); }
      }
      for (let i = pulses.length - 1; i >= 0; i--) {
        const p = pulses[i];
        p.t += p.sp * (dt / 16);
        if (p.t >= 1) { S.core = 1; group.remove(p.m); pulses.splice(i, 1); continue; }
        const ease = Math.pow(p.t, .82);
        const r = p.dir === 'out' ? lerp(CORE_R, REV_R, ease) : lerp(REV_R, CORE_R, ease);
        const a = p.a + p.spin * p.t * 2;
        p.m.position.set(Math.cos(a) * r, Math.sin(a) * r * .78, Math.sin(p.t * 6) * .35);
        p.m.scale.setScalar(.75 + Math.sin(p.t * Math.PI) * .9);
        // flash the ring it crosses
        rings.forEach(rg => { if (Math.abs(r - rg.st.r) < .1) rg.flash = Math.max(rg.flash, 1 - Math.abs(r - rg.st.r) / .1); });
      }

      renderer.render(scene, camera);

      // labels are projected from matrices that are current *after* rendering
      positionLabels3D();
      requestAnimationFrame(frame);
    }

    /* project a ring anchor point to a screen-space label position */
    const tmp = new THREE.Vector3();
    function positionLabels3D() {
      const labels = document.querySelectorAll('.orb-label');
      if (!labels.length) return;
      group.updateMatrixWorld(true);
      camera.updateMatrixWorld();
      const angles = [-.62, -.28, .12, .5, .88];
      STAGES.forEach((st, i) => {
        const el = labels[i];
        if (!el) return;
        const a = angles[i] + group.rotation.y * .35;
        tmp.set(Math.cos(a) * st.r, Math.sin(a) * st.r * .8, Math.sin(a * 1.7) * .2);
        group.localToWorld(tmp);
        tmp.project(camera);
        const x = (tmp.x * .5 + .5) * 100, y = (-tmp.y * .5 + .5) * 100;
        el.style.left = clamp(x, 2, 74).toFixed(1) + '%';
        el.style.top = clamp(y, 2, 92).toFixed(1) + '%';
        const flash = rings[i] ? rings[i].flash : 0;
        el.classList.toggle('on', flash > .25);
      });
    }

    /* pointer + scroll + touch */
    if (!COARSE) {
      S.stage.addEventListener('pointermove', e => {
        const r = S.stage.getBoundingClientRect();
        S.pointer.tx = ((e.clientX - r.left) / r.width - .5) * 2;
        S.pointer.ty = ((e.clientY - r.top) / r.height - .5) * 2;
      }, { passive: true });
      S.stage.addEventListener('pointerleave', () => { S.pointer.tx = 0; S.pointer.ty = 0; });
    } else {
      // touch: the scene reacts to drag instead of hover
      let lastX = 0;
      S.stage.addEventListener('touchstart', e => { lastX = e.touches[0].clientX; }, { passive: true });
      S.stage.addEventListener('touchmove', e => {
        const dx = e.touches[0].clientX - lastX;
        lastX = e.touches[0].clientX;
        S.pointer.tx = clamp(S.pointer.tx + dx * .01, -1, 1);
      }, { passive: true });
    }
    window.addEventListener('scroll', () => {
      S.scroll = clamp(window.pageYOffset / Math.max(1, window.innerHeight), 0, 1);
    }, { passive: true });

    resize();
    S.gl = { renderer: renderer, scene: scene };
    S.engine = 'gl';
    S.running = true;
    if (REDUCED) { renderer.render(scene, camera); positionLabels3D(); }
    else requestAnimationFrame(frame);

    // crossfade over the lite canvas
    requestAnimationFrame(() => {
      canvas.style.opacity = '1';
      if (S.liteCanvas) {
        S.liteCanvas.style.transition = 'opacity .9s ease';
        S.liteCanvas.style.opacity = '0';
        setTimeout(() => { if (S.liteCanvas) S.liteCanvas.style.display = 'none'; }, 950);
      }
      S.stage.classList.remove('lite');
      badge('gl');
      S.liteOff = true;                       // retire the 2D renderer
      setTimeout(() => { if (S.liteCanvas) S.liteCanvas.remove(); }, 1200);
    });
  }

  /* ---------------------------------------------------------
     BADGE — always tell the truth about the renderer
     --------------------------------------------------------- */
  function badge(kind) {
    if (!S.badge || !S.badgeText) return;
    const map = {
      gl: 'WebGL · live',
      lite: 'Lite renderer',
      static: 'Static · reduced motion',
      none: 'Static render'
    };
    S.badgeText.textContent = map[kind] || map.none;
    S.badge.classList.toggle('lite', kind !== 'gl');
  }

  /* ---------------------------------------------------------
     BOOT
     --------------------------------------------------------- */
  /* Host hand-off: the Next.js app registers the compiled R3F scene here
     (window.RevenuePilotOrb = { mount }). When present, the page runs the React
     scene and the vanilla tiers stand down. Absent that, nothing changes — the
     static build keeps working exactly as before. */
  function hostMount() {
    const host = window.RevenuePilotOrb;
    if (!host || typeof host.mount !== 'function') return false;
    const el = document.getElementById('orbMount');
    if (!el) return false;
    try {
      const handle = host.mount(el, {
        mobile: SMALL || COARSE,
        reduced: REDUCED,
        onStats: (s) => { S.stats.host = Object.assign({}, s); }
      });
      S.host = handle || null;
      S.engine = 'r3f';
      badge(REDUCED ? 'static' : 'webgl');
      if (S.stage) S.stage.classList.add('orb-live');
      return true;
    } catch (e) {
      S.engine = 'lite';       // fall through to the vanilla path untouched
      return false;
    }
  }

  /* reduced-motion hosts still get the React scene: it renders the same SVG
     fallback and never creates a WebGL context. Failing that, the poster stands. */
  function hostMountForReduced() {
    const host = window.RevenuePilotOrb;
    if (!host || typeof host.mount !== 'function') return false;
    const el = document.getElementById('orbMount');
    if (!el) return false;
    try {
      host.mount(el, { mobile: SMALL || COARSE, reduced: true });
      S.engine = 'r3f-static';
      return true;
    } catch (e) { return false; }
  }

  function init() {
    S.stage = document.getElementById('orbStage');
    S.mount = document.getElementById('orbMount');
    S.badge = document.getElementById('orbBadge');
    S.badgeText = document.getElementById('orbBadgeText');
    if (!S.stage || !S.mount) return;

    // reduced motion → the inline SVG poster IS the hero (no canvas, no loop)
    if (REDUCED) {
      S.engine = 'poster';
      badge('static');
      if (hostMountForReduced() && S.stage) S.stage.classList.add('orb-live');
      return;
    }

    // 1. instant paint: lite renderer, no dependencies, no network
    if (hostMount()) return;                       // React scene takes the stage
    let lite = null;
    try { lite = startLite(); }
    catch (e) {
      /* never fail silently: the reason a tier was skipped is diagnosable */
      lite = null;
      S.lastError = (e && (e.stack || e.message)) || String(e);
    }
    if (!lite) S.engine = 'poster';                // 2D unavailable → poster stands
    if (S.engine === 'lite') S.stage.classList.add('orb-live');
    badge(S.engine === 'lite' ? 'lite' : 'static');

    // 2. upgrade to WebGL when the browser is idle and it's worth it
    if (SAVE_DATA || !webglAvailable()) { badge('lite'); return; }
    const upgrade = () => loadThree(
      THREE => {
        try { startGL(THREE); }
        catch (e) { if (S.gl && S.gl.renderer) { try { S.gl.renderer.dispose(); } catch (e2) { } } badge('lite'); }
      },
      () => badge('lite')
    );
    if ('requestIdleCallback' in window) requestIdleCallback(upgrade, { timeout: 2200 });
    else setTimeout(upgrade, 1400);
  }

  return { init: init, state: S, hostMount: hostMount, force3D: () => loadThree(t => startGL(t), () => { }) };
})();
