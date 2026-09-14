/**
 * Build + proof of scope.
 *
 * Builds the lazy chunk twice:
 *   A. code-split (what production does) — must show three/react in a SEPARATE
 *      chunk, proving the landing page bundle does not carry the orb.
 *   B. standalone IIFE (used by orb-demo.html so the scene can be seen without
 *      a bundler or a network).
 */
import { build } from 'esbuild';
import { gzipSync } from 'node:zlib';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs';

const browserTarget = ['chrome100', 'firefox100', 'safari15', 'edge100'];
const common = { bundle: true, minify: true, target: browserTarget, legalComments: 'none', jsx: 'automatic' };

const size = (buf) => `${(buf.length / 1024).toFixed(1)} KB (${(gzipSync(buf).length / 1024).toFixed(1)} KB gz)`;

/* ---------- A. code-split: the shape the app actually ships ---------- */
rmSync('out-esm', { recursive: true, force: true });
await build({
  ...common,
  entryPoints: { 'OrbStageReact': 'src/OrbStageReact.jsx' },
  outdir: 'out-esm',
  format: 'esm',
  splitting: true,
  chunkNames: 'chunks/[name]-[hash]',
  metafile: true
}).then(async r => {
  writeFileSync('out-esm/meta.json', JSON.stringify(r.metafile));
  const files = [];
  const walk = (d) => readdirSync(d, { withFileTypes: true }).forEach(f => {
    const p = `${d}/${f.name}`;
    if (f.isDirectory()) walk(p); else if (p.endsWith('.js')) files.push(p);
  });
  walk('out-esm');

  const rows = files.map(f => {
    const buf = readFileSync(f);
    const txt = buf.toString();
    return {
      file: f,
      size: buf.length,
      gz: gzipSync(buf).length,
      three: /THREE\b|WebGLRenderer|BufferGeometry/.test(txt),
      react: /react-dom|useState|__SECRET_INTERNALS/.test(txt) || /createElement/.test(txt)
    };
  }).sort((a, b) => b.size - a.size);

  console.log('\n  code-split build (what the app ships)');
  console.log('  ' + '-'.repeat(74));
  for (const r of rows) {
    console.log('  ' + r.file.padEnd(34) + size(readFileSync(r.file)).padStart(22) +
      '   ' + (r.three ? 'three' : '') + (r.react ? ' react' : ''));
  }
  console.log('  ' + '-'.repeat(74));
  console.log('  ' + rows.reduce((a, r) => a + r.size, 0) / 1024 + ' KB total, of which the initial');
  console.log('  entry chunk is only what the page parses up front.');
});

/* Next.js flavour: next/dynamic is provided by the app, so it is external here */
await build({
  ...common,
  entryPoints: { 'OrbStage.next': 'src/OrbStage.jsx' },
  outdir: 'out-esm-next',
  format: 'esm',
  splitting: true,
  external: ['next/dynamic'],
  chunkNames: 'chunks/[name]-[hash]'
});
const nextChunks = readdirSync('out-esm-next/chunks', { withFileTypes: true })
  .filter(f => f.isFile()).map(f => 'out-esm-next/chunks/' + f.name)
  .map(f => ({ f, buf: readFileSync(f) }))
  .sort((a, b) => b.buf.length - a.buf.length);
const nextEntry = readdirSync('out-esm-next').filter(f => f.endsWith('.js'))
  .map(f => ({ f: 'out-esm-next/' + f, buf: readFileSync('out-esm-next/' + f) }))
  .sort((a, b) => b.buf.length - a.buf.length);
console.log('\n  Next.js flavour (next/dynamic external, as it is in the app)');
console.log('  ' + '-'.repeat(74));
for (const e of nextEntry) console.log('  ' + e.f.padEnd(34) + size(e.buf).padStart(22) + '   entry');
for (const c of nextChunks) console.log('  ' + c.f.padEnd(34) + size(c.buf).padStart(22) +
  '   ' + (/WebGLRenderer|BufferGeometry/.test(c.buf.toString()) ? 'three' : ''));
console.log('  ' + '-'.repeat(74));

/* ---------- B. standalone IIFE for the demo page ---------- */
rmSync('out-demo', { recursive: true, force: true });
mkdirSync('out-demo', { recursive: true });
await build({
  ...common,
  entryPoints: ['src/demo-main.jsx'],
  outfile: 'out-demo/orb.js',
  format: 'iife',
  loader: { '.js': 'jsx' },
  external: []
});
const demo = readFileSync('out-demo/orb.js');
console.log('\n  standalone demo bundle: ' + size(demo));
console.log('  (inlined into /home/user/orb-demo.html — self-contained, no network)\n');
