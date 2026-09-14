'use client';
/**
 * Framework-agnostic variant of OrbStage — same contract, no Next.js dependency.
 *
 * React.lazy + Suspense is what makes the code-splitting claim measurable: the
 * build output shows three.js landing in a separate chunk from the entry, so a
 * page that imports this still ships without the orb.
 *
 * (OrbStage.jsx is the Next.js flavour: identical behaviour, using
 * next/dynamic with ssr:false so nothing WebGL-shaped is attempted on the
 * server.)
 */
import React, { lazy, Suspense, useEffect, useRef, useState } from 'react';
import OrbFallback from './components/OrbFallback.jsx';

const HeroOrb = lazy(() => import('./HeroOrb.jsx'));

export default function OrbStageReact({ eager = false }) {
  const holder = useRef(null);
  const [ready, setReady] = useState(eager);
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    if (ready) return;
    if (typeof window === 'undefined') return;

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setReduced(true);
      return;
    }

    let idle = 0, io;
    const arm = () => {
      const go = () => setReady(true);
      if ('requestIdleCallback' in window) idle = requestIdleCallback(go, { timeout: 1800 });
      else idle = setTimeout(go, 320);
    };

    if (holder.current && 'IntersectionObserver' in window) {
      io = new IntersectionObserver(([e]) => {
        if (e.isIntersecting) { io.disconnect(); arm(); }
      }, { rootMargin: '300px' });
      io.observe(holder.current);
    } else {
      arm();
    }

    return () => {
      if (io) io.disconnect();
      if (idle) {
        if ('cancelIdleCallback' in window) cancelIdleCallback(idle);
        else clearTimeout(idle);
      }
    };
  }, [ready]);

  return (
    <div ref={holder} className="orb-stage-inner">
      {ready
        ? <Suspense fallback={<OrbFallback label="Preparing engine…" />}><HeroOrb /></Suspense>
        : <OrbFallback label={reduced ? 'Static · reduced motion' : 'Preparing engine…'} />}
    </div>
  );
}
