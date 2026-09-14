/**
 * Revenue pulses — the moving money.
 *
 * A pulse is a packet of data on a connection. It rides a segment, then *hops*
 * to the nearest segment further in (`nextHop`), up to three times; when it
 * cannot get closer it is drawn into the core and absorbed — which is the flash
 * you see at the centre. Occasionally an absorbed prospect is qualified and a
 * green pulse travels back OUT and leaves the system as revenue.
 *
 * The pool is small and fixed, so this costs the same whether one pulse or
 * fifteen are alive.
 */
import React, { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { makePulse, edgePoint, nextHop, pulseColor, ABSORB_R, CORE_R, REV_R } from '../../engine/pipeline.js';

const vert = /* glsl */ `
  uniform float uScale;
  attribute vec3 aColor;
  attribute float aSize;
  attribute float aOn;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    if (aOn < 0.5) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); }   // park unused slots off-screen
    gl_PointSize = clamp(aSize * uScale / max(0.001, -mv.z), 1.0, 60.0);
    vColor = aColor;
    vAlpha = aOn;
  }
`;

const frag = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec2 d = gl_PointCoord - 0.5;
    float f = smoothstep(0.5, 0.0, length(d));
    float a = f * f * vAlpha;
    if (a <= 0.002) discard;
    gl_FragColor = vec4(vColor * a, a);
  }
`;

export default function Pulses({ graph, mobile = false, flare, bloom, stats, reduced = false }) {
  const mat = useRef();
  const geo = useRef();
  const slots = graph.budget.pulseSlots;
  const lastQualified = useRef(-99);

  const refs = useMemo(() => {
    const positions = new Float32Array(slots * 3);
    const colors = new Float32Array(slots * 3);
    const sizes = new Float32Array(slots);
    const on = new Float32Array(slots);
    return { positions, colors, sizes, on };
  }, [slots]);

  const pool = useMemo(() => {
    const arr = [];
    for (let i = 0; i < slots; i++) {
      arr.push({ i, live: false, dir: 'in', t: 0, sp: 0, hops: 0, a: [0, 0, 0], b: [0, 0, 0], edge: -1, rev: false, size: 1 });
    }
    return arr;
  }, [slots]);

  function launch(p, time, qualified = false) {
    const e = Math.floor(Math.random() * graph.edges.length);
    p.edge = e;
    p.t = 0;
    p.rev = false;
    if (qualified) {
      /* qualified: straight out from the core to the boundary, then it is gone */
      p.dir = 'out';
      const a = Math.random() * Math.PI * 2;
      const y = (Math.random() - 0.5) * 1.2;
      p.a = [Math.cos(a) * CORE_R * 0.9, y, Math.sin(a) * CORE_R * 0.9];
      p.b = [Math.cos(a) * REV_R, y, Math.sin(a) * REV_R];
      p.sp = 0.055;                    // travels in seconds, not per-frame fractions
      p.size = 0.085;                  // world units
    } else {
      const cfg = makePulse('in', Math.random);
      p.dir = 'in';
      p.hops = cfg.hops;
      p.a = edgePoint(graph.edges[e], 0);
      p.b = edgePoint(graph.edges[e], 1);
      p.sp = cfg.sp * 46;              // per-frame fraction → per-second speed
      p.size = 0.062;                  // world units
    }
    p.live = true;
    p.born = time;
  }

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.05);          // tab-switch guard: never teleport
    const time = state.clock.elapsedTime;

    if (reduced) return;                        // belt and braces; reduced never mounts a canvas

    /* fill the pipeline: new inbound traffic, up to pool capacity */
    let live = 0;
    for (let i = 0; i < slots; i++) if (pool[i].live) live++;
    if (live < slots && Math.random() < 0.075) {
      for (let i = 0; i < slots; i++) {
        if (!pool[i].live) { launch(pool[i], time, false); stats.pulses++; break; }
      }
    }

    /* a qualified lead leaves the system every few seconds */
    if (time - lastQualified.current > 4.5 && live > 2 && Math.random() < 0.02) {
      for (let i = 0; i < slots; i++) {
        if (!pool[i].live) {
          launch(pool[i], time, true);
          lastQualified.current = time;
          stats.qualified++;
          break;
        }
      }
    }

    for (let i = 0; i < slots; i++) {
      const p = pool[i];
      if (!p.live) { refs.on[i] = 0; continue; }

      p.t += p.sp * dt;

      if (p.t >= 1) {
        if (p.dir === 'final') {
          /* straight-line final approach landed: absorbed by the core */
          p.live = false;
          refs.on[i] = 0;
          flare.current = Math.min(1, flare.current + 0.22);
          stats.absorbed++;
          continue;
        }
        if (p.dir === 'out') {
          /* left the system — this is the revenue moment */
          p.live = false;
          bloom.current = { active: true, t: 0 };
          refs.on[i] = 0;
          continue;
        }
        const pos = edgePoint(graph.edges[p.edge], p.t, p.rev);
        const radius = Math.hypot(pos[0], pos[1], pos[2]);

        if (radius < ABSORB_R) {
          /* reached the core: absorb it and flash the centre */
          p.live = false;
          refs.on[i] = 0;
          flare.current = Math.min(1, flare.current + 0.3);
          stats.absorbed++;
          continue;
        }

        if (p.hops > 0) {
          const hop = nextHop(pos, graph.edges, p.edge, { maxDist: mobile ? 2.4 : 2.9 });
          if (hop) {
            p.edge = hop.index;
            p.rev = hop.reverse;
            p.t = 0;
            p.hops--;
            p.a = edgePoint(graph.edges[p.edge], 0, p.rev);
            p.b = edgePoint(graph.edges[p.edge], 1, p.rev);
            stats.hops++;
            continue;
          }
        }

        /* out of hops and still outside the core: make a final approach inward */
        const len = radius || 1;
        p.a = pos;
        p.b = [pos[0] / len * CORE_R * 0.5, pos[1] / len * CORE_R * 0.5, pos[2] / len * CORE_R * 0.5];
        p.t = 0;
        p.dir = 'final';
      }

      /* integrate position */
      const g = p.dir === 'final'
        ? [p.a[0] + (p.b[0] - p.a[0]) * p.t, p.a[1] + (p.b[1] - p.a[1]) * p.t, p.a[2] + (p.b[2] - p.a[2]) * p.t]
        : edgePoint(graph.edges[p.edge], p.t, p.rev);

      refs.positions[i * 3] = g[0];
      refs.positions[i * 3 + 1] = g[1];
      refs.positions[i * 3 + 2] = g[2];

      const r = Math.hypot(g[0], g[1], g[2]);
      const progress = Math.min(1, Math.max(0, (REV_R - r) / (REV_R - 1.2)));
      const c = p.dir === 'out' ? pulseColor('out', 1) : pulseColor('in', progress);
      refs.colors[i * 3] = c[0]; refs.colors[i * 3 + 1] = c[1]; refs.colors[i * 3 + 2] = c[2];
      refs.sizes[i] = p.size * (p.dir === 'out' ? 1.25 : 1) * (0.85 + progress * 0.4);
      refs.on[i] = 1;
    }

    if (geo.current) {
      geo.current.attributes.position.needsUpdate = true;
      geo.current.attributes.aColor.needsUpdate = true;
      geo.current.attributes.aSize.needsUpdate = true;
      geo.current.attributes.aOn.needsUpdate = true;
    }
    if (mat.current) {
      mat.current.uniforms.uTime.value = time;
      const fov = (state.camera.fov * Math.PI) / 180;
      mat.current.uniforms.uScale.value =
        (state.size.height * state.gl.getPixelRatio()) / (2 * Math.tan(fov / 2));
    }
  });

  const uniforms = useMemo(() => ({ uTime: { value: 0 }, uScale: { value: 1200 } }), []);

  return (
    <points frustumCulled={false} renderOrder={4}>
      <bufferGeometry ref={geo}>
        <bufferAttribute attach="attributes-position" args={[refs.positions, 3]} />
        <bufferAttribute attach="attributes-aColor" args={[refs.colors, 3]} />
        <bufferAttribute attach="attributes-aSize" args={[refs.sizes, 1]} />
        <bufferAttribute attach="attributes-aOn" args={[refs.on, 1]} />
      </bufferGeometry>
      <shaderMaterial
        ref={mat}
        vertexShader={vert}
        fragmentShader={frag}
        uniforms={uniforms}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
}
