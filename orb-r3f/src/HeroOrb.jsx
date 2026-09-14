/**
 * HeroOrb — the lazy-loaded entry point.
 *
 * This is the ONLY module the page loads asynchronously. It re-checks every
 * reason not to run before it touches three:
 *   · prefers-reduced-motion  → static SVG, no WebGL context created at all
 *   · no WebGL support        → static SVG
 *   · save-data / slow link   → static SVG
 *   · context creation throws → static SVG
 *
 * If any of those hit, the visitor still gets the full pipeline picture, because
 * the fallback is the same diagram the WebGL scene renders.
 */
import React, { useEffect, useMemo, useState } from 'react';
import OrbFallback from './components/OrbFallback.jsx';
import OrbScene from './components/OrbScene.jsx';

function webglOK() {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl') || c.getContext('experimental-webgl');
    if (!gl) return false;
    const lose = gl.getExtension && gl.getExtension('WEBGL_lose_context');
    if (lose) lose.loseContext();
    return true;
  } catch (e) {
    return false;
  }
}

export default function HeroOrb({ onStats, forceReduced = false }) {
  const env = useMemo(() => {
    if (typeof window === 'undefined') return { reduced: true, mobile: false, ok: false };
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const mobile = window.matchMedia('(pointer: coarse)').matches || window.innerWidth < 900;
    const conn = navigator.connection || {};
    const cheap = conn.saveData === true || /2g/.test(conn.effectiveType || '');
    /* forceReduced is a QA hook used by the demo page to show the static tier */
    return { reduced: reduced || forceReduced, mobile, ok: !reduced && !forceReduced && !cheap && webglOK() };
  }, [forceReduced]);

  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!env.ok) return;
    const onError = () => setFailed(true);
    window.addEventListener('error', onError);
    return () => window.removeEventListener('error', onError);
  }, [env.ok]);

  if (!env.ok || failed) {
    return <OrbFallback label={env.reduced ? 'Static · reduced motion' : 'Static · no WebGL'} />;
  }

  return (
    <div className="orb-canvas" data-engine="webgl" data-mobile={env.mobile ? 'true' : 'false'}>
      <OrbScene mobile={env.mobile} reduced={false} onStats={onStats} className="orb-canvas-inner" />
    </div>
  );
}
