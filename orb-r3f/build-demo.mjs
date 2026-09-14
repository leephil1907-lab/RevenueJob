/**
 * Produces /home/user/orb-demo.html — a self-contained page that runs the real
 * R3F scene with no network access at all (the bundle is inlined).
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { build } from 'esbuild';

/* Bundle here rather than inlining whatever happened to be in out-demo already:
   a stale bundle silently ships last build's code, which is exactly the kind of
   bug that survives a "looks fine" screenshot. */
mkdirSync('out-demo', { recursive: true });
await build({
  bundle: true,
  minify: true,
  target: ['chrome100', 'firefox100', 'safari15', 'edge100'],
  legalComments: 'none',
  jsx: 'automatic',
  entryPoints: ['src/demo-main.jsx'],
  outfile: 'out-demo/orb.js',
  format: 'iife',
  loader: { '.js': 'jsx' }
});

const js = readFileSync('out-demo/orb.js', 'utf8')
  /* an inlined script must never contain a literal closing tag */
  .replace(/<\/script>/gi, '<\\/script>');

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>RevenuePilot — hero orb (R3F scene, live)</title>
<style>
  :root{
    --bg:#04060d; --ink:#eef3ff; --dim:#93a2c9; --line:rgba(140,165,255,.16);
    --cyan:#5ae7ff; --indigo:#8a6bff; --blue:#6fa8ff; --green:#46e3a4;
    --mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  }
  *{box-sizing:border-box}
  html,body{margin:0;background:var(--bg);color:var(--ink);
    font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
  body{min-height:220vh;display:grid;grid-template-columns:1.15fr .85fr;align-items:start;
    background:
      radial-gradient(1100px 620px at 22% 12%,rgba(111,168,255,.13),transparent 62%),
      radial-gradient(900px 560px at 78% 82%,rgba(138,107,255,.11),transparent 60%),
      var(--bg);}
  @media (max-width:980px){body{grid-template-columns:1fr}}

  .left{padding:clamp(28px,5vw,64px);display:flex;flex-direction:column;justify-content:center;
    gap:22px;min-height:100vh;position:sticky;top:0}
  .scroll-note{position:fixed;left:0;right:0;bottom:0;margin:0;z-index:5;
    padding:10px clamp(20px,3vw,36px);color:#7c8bb4;font:11.5px/1.5 var(--mono);
    background:rgba(4,6,13,.82);border-top:1px solid var(--line);backdrop-filter:blur(6px)}
  .kicker{font:600 11.5px/1 var(--mono);letter-spacing:.16em;text-transform:uppercase;color:var(--cyan)}
  h1{margin:0;font-size:clamp(34px,4.6vw,60px);line-height:1.02;letter-spacing:-.03em;font-weight:650}
  p.lede{margin:0;max-width:56ch;color:var(--dim);font-size:clamp(15px,1.35vw,17.5px);line-height:1.62}
  .cta{display:flex;gap:12px;flex-wrap:wrap;margin-top:6px}
  .btn{border-radius:10px;padding:13px 20px;font-weight:600;font-size:14.5px;border:1px solid transparent;cursor:pointer}
  .btn.p{background:linear-gradient(180deg,#7fb6ff,#5c8bff);color:#04060d}
  .btn.s{background:rgba(255,255,255,.04);border-color:var(--line);color:var(--ink)}
  .note{font:12px/1.6 var(--mono);color:#6f7fa8;border-left:2px solid var(--line);padding-left:12px}

  .right{border-left:1px solid var(--line);padding:clamp(18px,2.4vw,30px) clamp(18px,2.4vw,30px) 46px;
    display:flex;flex-direction:column;gap:12px;justify-content:flex-start;height:100vh;
    position:sticky;top:0;overflow:hidden}
  @media (max-width:980px){.right{border-left:0;border-top:1px solid var(--line);position:static;height:auto}}

  .stage{position:relative;width:min(100%,42vh);aspect-ratio:1/1;margin:0 auto}
  .stage::after{content:"";position:absolute;inset:0;pointer-events:none;
    background:radial-gradient(circle at 50% 50%,transparent 58%,rgba(4,6,13,.55) 100%)}
  #orb-root{display:flex;flex-direction:column;gap:16px;width:100%}

  .orb-canvas{width:100%;height:100%}
  .orb-fallback{position:relative;width:100%;height:100%}
  .orb-badge-fallback{position:absolute;left:50%;bottom:8px;transform:translateX(-50%);
    font:11px/1 var(--mono);color:var(--dim);border:1px solid var(--line);border-radius:999px;padding:6px 11px;
    background:rgba(4,6,13,.6);white-space:nowrap}

  .readout{margin:0;display:grid;gap:5px;font:12px/1.3 var(--mono)}
  .readout>div{display:flex;justify-content:space-between;gap:14px;
    border-bottom:1px dashed rgba(140,165,255,.13);padding-bottom:7px}
  .readout dt{color:var(--dim)}
  .readout dd{margin:0;color:var(--ink);font-weight:600;font-variant-numeric:tabular-nums}
  .engine-tag{position:absolute;left:10px;top:10px;font:11px/1 var(--mono);color:var(--blue);
    border:1px solid rgba(111,168,255,.32);background:rgba(8,14,30,.72);border-radius:999px;padding:6px 11px}
  .engine-tag[data-mode="static"]{color:var(--dim);border-color:var(--line)}

  .stage-list{display:grid;gap:11px}
  .stage-list>div{display:grid;gap:3px;border-left:2px solid rgba(140,165,255,.2);padding-left:11px}
  .stage-list b{font:600 11.5px/1 var(--mono);letter-spacing:.08em;color:var(--cyan)}
  .stage-list span{color:var(--dim);font-size:13px;line-height:1.5}

  .toggle{margin-top:2px;align-self:flex-start;border-radius:9px;padding:10px 15px;font:600 12.5px/1 inherit;
    background:rgba(255,255,255,.04);border:1px solid var(--line);color:var(--ink);cursor:pointer}

  .tag{display:inline-flex;gap:7px;align-items:center;font:11px/1 var(--mono);color:var(--green);
    border:1px solid rgba(70,227,164,.3);background:rgba(70,227,164,.07);border-radius:999px;padding:7px 11px}
  .dot{width:6px;height:6px;border-radius:50%;background:var(--green)}
  .hint{font:11.5px/1.6 var(--mono);color:#6f7fa8}
</style>
</head>
<body>
  <main class="left">
    <span class="kicker">RevenuePilot · hero orb · R3F + Three.js</span>
    <h1>Your AI revenue team. Always working.</h1>
    <p class="lede">RevenuePilot deploys intelligent AI agents that research prospects, engage conversations, qualify opportunities, follow up automatically, and help your team turn pipeline into measurable revenue.</p>
    <div class="cta">
      <button class="btn p">Deploy your AI agent</button>
      <button class="btn s">See how it works</button>
    </div>
    <p class="note">Product-preview figures. Demo data — not customer results.<br>
      Every moving element below is a prospect, a data hop, or a qualified lead.</p>
    <div id="stages-root"></div>
  </main>

  <aside class="right">
    <div id="orb-root"></div>
    <span class="tag"><i class="dot"></i>Live readout from the running scene</span>
    <p class="hint">Drag to turn · scroll the page to push the camera in.</p>
  </aside>
  <p class="scroll-note">Scroll: the camera pushes in and lifts as the page descends. The orb column is
  sticky, so this is the hero behaving under scroll — not a video.</p>
<script>${js}</script>
</body>
</html>`;

writeFileSync('/home/user/orb-demo.html', html);
console.log('orb-demo.html written: ' + (html.length / 1024).toFixed(1) + ' KB');
