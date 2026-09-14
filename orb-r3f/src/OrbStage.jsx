'use client';
/**
 * OrbStage — what the landing page actually renders.
 *
 * Two rules are enforced here, and they are the whole reason this component
 * exists rather than a bare <Canvas> in the hero:
 *
 * 1. NEVER BLOCK THE HERO. The SVG fallback renders on the very first paint.
 *    The WebGL chunk is requested only after the page is idle and the stage is
 *    near the viewport, and it is code-split, so three.js is not in the initial
 *    bundle at all.
 *
 * 2. NEVER LEAVE A HOLE. Until the chunk resolves, and forever on devices that
 *    cannot run it, the fallback is the hero.
 *
 * Usage:
 *   import OrbStage from '@/components/OrbStage';
 *   <div className="orb-stage"><OrbStage /></div>
 */
import React, { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import OrbFallback from './components/OrbFallback.jsx';

const HeroOrb = dynamic(() => import('./HeroOrb.jsx'), {
  ssr: false,
  loading: () => <OrbFallback label="Loading…" />
});

export default function OrbStage({ eager = false }) {
  const holder = useRef(null);
  const [ready, setReady] = useState(eager);
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    if (ready) return;

    /* reduced motion: never request the chunk at all — no context, no loop */
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setReduced(true);
      setReady(false);
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
      {ready ? <HeroOrb /> : <OrbFallback label={reduced ? 'Static · reduced motion' : 'Preparing engine…'} />}
    </div>
  );
}
