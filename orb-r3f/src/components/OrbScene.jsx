/**
 * The R3F canvas. This module is the lazy chunk: importing it pulls in three,
 * @react-three/fiber and the whole scene, so nothing else in the page may
 * import it statically.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import * as THREE from 'three';

import { buildGraph, ABSORB_R } from '../engine/pipeline.js';
import Shell from './scene/Shell.jsx';
import Rings from './scene/Rings.jsx';
import Nodes from './scene/Nodes.jsx';
import Connections from './scene/Connections.jsx';
import Pulses from './scene/Pulses.jsx';
import Core from './scene/Core.jsx';
import Rig from './scene/Rig.jsx';

export default function OrbScene({ mobile = false, reduced = false, onStats, className = '' }) {
  const root = useRef();
  const flare = useRef(0);
  const bloom = useRef({ active: false, t: 0 });
  const stats = useRef({ pulses: 0, hops: 0, absorbed: 0, qualified: 0 });
  const [running, setRunning] = useState(true);
  const rigState = useRef({ scroll: 0, camDist: 12.4, camY: 1.5, spin: 0 });

  const graph = useMemo(() => buildGraph({ mobile }), [mobile]);

  /* Stop the loop when the hero is off-screen or the tab is hidden. The orb must
     never cost frames while the visitor is reading the rest of the page. */
  const holder = useRef(null);
  useEffect(() => {
    const onVis = () => setRunning(!document.hidden);
    document.addEventListener('visibilitychange', onVis);
    let io;
    if (holder.current && 'IntersectionObserver' in window) {
      io = new IntersectionObserver(([e]) => setRunning(e.isIntersecting && !document.hidden), { threshold: 0.01 });
      io.observe(holder.current);
    }
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      if (io) io.disconnect();
    };
  }, []);

  /* flare decay lives here so the core stays a pure renderer of it */
  useEffect(() => {
    if (!running) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      flare.current *= Math.pow(0.88, dt * 60);
      if (flare.current < 0.001) flare.current = 0;
      if (onStats) {
        onStats({
          ...rigState.current,
          pulses: stats.current.pulses,
          hops: stats.current.hops,
          absorbed: stats.current.absorbed,
          qualified: stats.current.qualified,
          flare: flare.current,
          nodes: graph.nodes.length,
          edges: graph.edges.length,
          dust: graph.dust.length / 4
        });
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [running, onStats, graph]);

  return (
    <div ref={holder} className={className} style={{ width: '100%', height: '100%' }}>
      <Canvas
        frameloop={running ? 'always' : 'never'}
        dpr={[1, mobile ? 1.25 : 1.6]}
        camera={{ position: [0, 1.5, 12.4], fov: 42, near: 0.1, far: 100 }}
        gl={{
          antialias: !mobile,
          alpha: true,
          powerPreference: 'high-performance',
          stencil: false,
          depth: true
        }}
        onCreated={({ gl }) => {
          gl.setClearAlpha(0);
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = 1.05;
        }}
      >
        {/* cyan/indigo illumination — low ambient so the scene stays dark and lit */}
        <ambientLight intensity={0.35} color="#8a9cff" />
        <pointLight position={[-7, 5, 6]} intensity={38} distance={26} color="#6fa8ff" />
        <pointLight position={[6, -4, -5]} intensity={26} distance={24} color="#8a6bff" />
        <pointLight position={[0, 0, 3]} intensity={14} distance={14} color="#5ae7ff" />

        <group ref={root}>
          <Shell />
          <Rings />
          <Nodes graph={graph} mobile={mobile} reduced={reduced} />
          <Connections graph={graph} />
          <Pulses graph={graph} mobile={mobile} flare={flare} bloom={bloom} stats={stats.current} reduced={reduced} />
          <Core flare={flare} bloom={bloom} />
        </group>

        <Rig root={root} mobile={mobile} reduced={reduced}
          onStats={(s) => Object.assign(rigState.current, s)} />
      </Canvas>
    </div>
  );
}

/* exposed for the demo page's HUD */
export { ABSORB_R };
