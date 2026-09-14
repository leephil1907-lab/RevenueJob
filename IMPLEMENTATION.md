# RevenuePilot — Build Handoff

**Deliverables**

| File | What it is |
|---|---|
| `index.html` | the whole product: marketing site + RevenuePilot OS + hero (single file, no dependencies) |
| `orb-demo.html` | the R3F hero scene running live, with an instrumented readout (self-contained, ~1 MB) |
| `orb-r3f/` | the React Three Fiber project: engine, components, build, tests |
| `INTEGRATION-ORB.md` | how to drop the orb into the Next.js app, with measured bundle numbers |
| `src/` | source layers for the single-file build; `node assemble.js` rebuilds `index.html` |

---

## 1. The hero orb

A living revenue engine — **Prospects → Intelligence → Conversations →
Opportunities → Revenue** — in four tiers, each with its own job.

| Tier | Runs when | What it is |
|---|---|---|
| **0 · SVG** | JS off · reduced motion · no WebGL and no 2D canvas | The pipeline drawn in SVG: five stage rings, nodes, converging connections, AI core, a prospect entering and a qualified lead leaving |
| **1 · Lite** | always, instantly | 2D canvas: stage rings, stage-to-stage connections each carrying a data pulse, pulses converging on the core, qualified pulses travelling back out |
| **2 · WebGL** | browser idle + WebGL + bandwidth allow | The full scene (below) |
| **3 · R3F** | when the Next.js app registers the compiled scene | The same scene as a code-split React component |

**What the WebGL scene actually is:** a dark translucent containment sphere with
a lat/long lattice; five stage rings, each in its own tilted orbital plane so the
connections cross in three dimensions; 740 node particles on those rings plus
2,400 dust particles on the shell plus 420 prospects in motion (a vertex shader
moves them inward, brightens and absorbs them); ~316 connection segments, each
carrying a travelling highlight; a pulse pool whose packets ride a segment, then
**hop to the nearest segment further in**, up to three times, and finally feed the
core — each absorption flares the core, and every few seconds a green qualified
pulse travels back out and leaves a bloom ring behind. Indigo→cyan inbound,
green outbound, ACES tone mapping, additive blending throughout.

**Motion & interaction.** Slow autonomous rotation on two axes; damped pointer
parallax on desktop (exponential easing, never linear); scroll pushes the camera
from z 12.4 → 9.6 and lifts it from y 1.5 → 3.9; touch drag turns the system with
a decaying fling; the loop stops completely when the hero is off-screen or the
tab is hidden.

### Verified, not assumed

```
$ cd orb-r3f && node test-math.mjs        → 32/32  engine: geometry, flow direction, hop rules
$ node build.mjs                          → code-split proof + bundle sizes
$ node verify-browser.mjs                 → 13/13  real Chromium (software WebGL) + screenshots
```

The browser run confirms, in order: WebGL tier live · 2,400 shell particles ·
316 connection segments · pulses travelling · scroll 12.40 → 9.60 ·
rotation 22° → 29° autonomous · absorptions happening · reduced-motion tier
creating **no canvas at all** · mobile using a smaller system (900 particles,
`mobile=true`) · touch drag turning it · the loop freezing off-screen · zero page
errors on desktop and mobile.

### Scoping (the "don't slow the landing page down" requirement)

Measured from `node build.mjs`:

```
OrbStage.next.js              1.0 KB (0.6 KB gz)   ← what the landing page parses
chunks/HeroOrb-*.js         817.6 KB (221.1 KB gz) ← three + react, loaded on demand
chunks/chunk-*.js            10.6 KB (4.0 KB gz)
```

The chunk is requested only after the page is idle *and* the stage is near the
viewport; `ssr: false`; reduced-motion devices never request it at all.

### Fallback ladder (in the single-file build)

`window.RevenuePilotOrb.mount` (host scene) → 2D lite renderer → inline SVG
poster. Every rung was tested; the badge always states which one is live.

Bugs this phase's testing caught, each of which would have shipped:

- point size computed wrong for the camera FOV — every particle drew ~150px wide
  and 2,400 particles washed the stage into flat grey;
- `edgePoint` keyed its exact endpoints on `rev` instead of `u`, silently
  inverting reversed traversal;
- the hop rule was only a bias, so pulses could visibly drift *outward*;
- dust allowed fractionally outside the containment shell;
- Core had one ref shared by a mesh and its material — `useFrame` would have
  thrown on first frame;
- `startLite` had no return value while the caller tested its result, so any
  build of the new code reported "poster" even with a healthy canvas;
- a null 2D context threw during startup and took the **entire page** down, not
  just the orb (guarded now: atmosphere and charts skip, page continues);
- `build-demo.mjs` inlined a stale bundle — the demo silently shipped the
  previous build's code. It now bundles its own input.

---

## 2. Honesty of data

The brief: *don't invent customer results or testimonials; mark preview data.*

- **Customer evidence**: four composite scenarios, each tagged
  `Illustrative · not a real customer`, a section notice, and a published standard
  (named + permissioned · one sourced metric · no averaging · references on
  request). One attribute publishes the real thing: `data-evidence="real"` on
  `#proof` and the placeholder notices disappear by CSS while the cards remain.
- **Pricing**: `Illustrative` notice — placeholder structure, not an offer.
- **Hero / OS metrics**: "Product-preview figures. Demo data — not customer
  results", plus `Demo data` pills on the console surfaces.
- In-product personas exist **inside** the clearly-labelled demo console as
  workflow records, never as customers or testimonials.

---

## 3. RevenuePilot OS (in `index.html`)

15 operable surfaces: Command Center · Agents · Supervisor · Approvals · Copilot ·
Universal inbox · Prospects · Lead intelligence · Revenue intelligence (forecast,
attribution, what-if, coach) · Agent Builder · Marketplace · Agency · Developers ·
Trust & audit · Settings. Kill switch cascades across the fleet; currency via
`Intl` (USD/EUR/GBP/NGN/BRL/JPY/AED); UI in en/fr/de/pt/es/ar with RTL; agent
working language independent of UI language.

---

## 4. Verification status

```
node assemble.js              → structure OK (427 KB, 956 divs, 25 sections)
node test_smoke.js            → 106/106
node test_variants.js reduced →  17/17
node test_variants.js mobile  →   8/8
node test_orb.js              →  27/27   (lazy load, fallback ladder, host hand-off)
cd orb-r3f && node test-math.mjs        → 32/32
cd orb-r3f && node verify-browser.mjs   → 13/13
```

`npm i jsdom` in `/home/user` first (not persisted); puppeteer + the apt libs
listed in `INTEGRATION-ORB.md` for the browser suite.

---

## 5. What's left for you

1. **Real content** — flip `data-evidence="real"`, drop in permissioned quotes and
   sourced numbers, replace the illustrative pricing table.
2. **Real metrics** — every demo figure lives in one small data layer
   (`state`, `INTEL`, `ATTR`, `APPROX` in `src/p17_js_os.js`); swap and the UI
   follows.
3. **Backend** — auth, payments, data residency and the API are described in the
   UI but deliberately not implemented; the UI states their shape rather than
   pretending they exist.
