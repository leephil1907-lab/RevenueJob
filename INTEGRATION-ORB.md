# Hero orb — Next.js / R3F integration

The orb is a real React Three Fiber project, built and verified here; it is not a
sketch. Everything below runs from `orb-r3f/`.

```
orb-r3f/
  src/engine/pipeline.js          pure geometry + flow rules (no three, no react)
  src/components/OrbStage.jsx     ← import this into the landing page
  src/components/OrbFallback.jsx  the SVG tier-0 hero (no JS, no WebGL needed)
  src/components/OrbScene.jsx     the lazy R3F canvas
  src/components/scene/           Shell · Rings · Nodes · Connections · Pulses · Core · Rig
  src/HeroOrb.jsx                 lazy entry: capability checks before three loads
  test-math.mjs                   engine tests (node, no GPU)
  build.mjs                       code-split build + scope proof
  verify-browser.mjs              real-browser verification (uses puppeteer)
  build-demo.mjs                  builds ../orb-demo.html (self-contained)
```

## 1. Install

```bash
npm i three@0.169.0 @react-three/fiber@8.17.10 react@18.3.1 react-dom@18.3.1
```

Next.js is only needed for `next/dynamic`; nothing else in the orb depends on it.

## 2. Drop the files in

```
components/orb/            ← copy orb-r3f/src/*
```

## 3. Use it in the hero

```jsx
import OrbStage from '@/components/orb/OrbStage';

<div className="orb-stage">
  <OrbStage />
</div>
```

That is the whole integration. `OrbStage` renders the SVG fallback on the first
paint and only then requests the WebGL chunk, so the hero is never blocked:

- the chunk is requested only after the page is idle **and** the stage is within
  300px of the viewport;
- `ssr: false` — nothing WebGL-shaped is attempted on the server;
- with `prefers-reduced-motion` the chunk is **never requested** and the SVG tier
  stays permanently;
- no WebGL, save-data or a 2G estimate → SVG tier, immediately.

## 4. What it costs (measured, not estimated)

`node build.mjs` prints the split:

```
OrbStage.next.js                   1.0 KB (0.6 KB gz)   entry
chunks/HeroOrb-*.js              817.6 KB (221.1 KB gz)  three + react + scene
chunks/chunk-*.js                 10.6 KB (4.0 KB gz)
```

The landing page parses **0.6 KB gz** of orb code up front; the heavy chunk is
loaded on demand and never on reduced-motion devices.

## 5. Registering the hand-off in the static build

The static `index.html` (this repo's single-file build) ships the zero-dependency
renderers, because a single HTML file cannot resolve ESM React + three without a
bundler. It will use the compiled R3F scene instead, the moment the app provides
it — one global, no rebuild of the page:

```js
import { createRoot } from 'react-dom/client';
import HeroOrb from '@/components/orb/HeroOrb';

window.RevenuePilotOrb = {
  mount(el, opts) {                       // called by OrbEngine.init()
    const root = createRoot(el);
    root.render(<HeroOrb forcedMobile={opts.mobile} forcedReduced={opts.reduced} />);
    return { unmount: () => root.unmount() };
  }
};
```

`opts` carries `{ mobile, reduced }`. The page then reports `engine: 'r3f'` and
retires its own renderers, including the SVG poster. If the hand-off throws, the
page falls back to the vanilla tiers untouched — the visitor never sees a gap.

## 6. Verifying it yourself

```bash
node test-math.mjs        # 32 engine checks: geometry, flow direction, hop rules
node build.mjs            # code-split proof + sizes
node build-demo.mjs       # writes ../orb-demo.html
node verify-browser.mjs   # 13 real-browser checks + screenshots/
```

`verify-browser.mjs` needs puppeteer and a Chromium that can do software WebGL:

```bash
npm i -D puppeteer
sudo apt-get install -y libnspr4 libnss3 libatk1.0-0 libatk-bridge2.0-0 \
  libcups2 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 \
  libxrandr2 libgbm1 libasound2 libpango-1.0-0 libcairo2 fonts-liberation
```

## 7. Tuning knobs

| What | Where |
|---|---|
| Ring radii, colours, per-stage node counts | `src/engine/pipeline.js` → `STAGES` |
| Ring plane tilts (how three-dimensional it reads) | `RING_TILT`, `RING_SPIN` |
| Particle / edge / pulse budgets, mobile vs desktop | `BUDGET` |
| Core absorb radius (when a pulse is "converted") | `ABSORB_R` |
| Pulse speed, hop limit, qualified-lead cadence | `src/components/scene/Pulses.jsx` |
| Camera push distance under scroll | `src/components/scene/Rig.jsx` (12.4 → 9.6) |
| Flare on absorption, bloom on qualification | `Core.jsx`, `OrbScene.jsx` |

## 8. Accessibility contract

- The SVG tier carries a `role="img"` label describing the pipeline in words.
- Reduced motion: no canvas, no WebGL context, no animation loop.
- Pointer/keyboard: the orb is decorative-by-design and hosts no controls, so it
  takes no focus and never intercepts scrolling (all listeners are passive).
- The scene stops entirely when off-screen or when the tab is hidden.
