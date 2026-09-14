/**
 * Every particle in the system, in one draw call.
 *
 * Two behaviours share the buffer:
 *   aKind 0 — a node sitting on its stage ring (a prospect/data point at rest)
 *   aKind 1 — a prospect in motion: it enters at the outer boundary, converges
 *             inward through the stage rings, brightens as it is understood, and
 *             is absorbed by the AI core. Then it is recycled as a new prospect.
 *
 * All of that happens in the vertex shader from per-point attributes, so the CPU
 * never touches thousands of particles per frame.
 */
import React, { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { STAGES, CORE_R, REV_R, SHELL_R } from '../../engine/pipeline.js';

const vert = /* glsl */ `
  uniform float uTime;
  uniform float uScale;
  uniform float uCoreR;
  uniform float uFlow;         // 0 disables motion entirely (reduced-motion safety)
  attribute vec3 aColor;
  attribute float aSize;
  attribute float aKind;
  attribute float aPhase;
  attribute float aSpeed;
  attribute float aDrift;
  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    vec3 p = position;
    float e = 0.0;

    if (aKind > 0.5 && uFlow > 0.5) {
      float t = fract(aPhase + uTime * aSpeed);
      e = t * t * (3.0 - 2.0 * t);                       // ease, never linear
      float r0 = length(position.xz);
      float r1 = uCoreR * 0.30;                          // absorbed into the core
      float r = mix(r0, r1, e);
      // slight angular drift: prospects are not on rails, they are being worked
      float ang = atan(position.z, position.x) + e * aDrift * 2.4;
      p = vec3(cos(ang) * r, position.y * (1.0 - e * 0.9), sin(ang) * r);
    }

    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    /* uScale converts world units to device pixels for this camera and viewport:
       px = worldSize * (heightPx / (2 * tan(fov/2))) / distance */
    gl_PointSize = clamp(aSize * uScale / max(0.001, -mv.z), 0.8, 24.0);

    if (aKind > 0.5) {
      vAlpha = 0.16 + 0.84 * e;                          // fades in as it converges
      vColor = mix(aColor, vec3(0.80, 0.94, 1.0), e * 0.75);
    } else {
      vAlpha = 0.34 + 0.34 * sin(uTime * 0.55 + aPhase * 9.0);
      vColor = aColor;
    }
  }
`;

const frag = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec2 d = gl_PointCoord - 0.5;
    float f = smoothstep(0.5, 0.06, length(d));
    if (f <= 0.001) discard;
    gl_FragColor = vec4(vColor * f * vAlpha, 1.0);       // additive: alpha lives in rgb
  }
`;

export default function Nodes({ graph, mobile = false, reduced = false }) {
  const mat = useRef();
  const { positions, colors, sizes, kinds, phases, speeds, drifts } = useMemo(() => {
    const nodes = graph.nodes;
    /* prospect flow particles — every one starts at the outer boundary */
    const flowCount = mobile ? 160 : 420;
    const dustCount = graph.dust.length / 4;
    const total = nodes.length + flowCount + dustCount;
    const positions = new Float32Array(total * 3);
    const colors = new Float32Array(total * 3);
    const sizes = new Float32Array(total);
    const kinds = new Float32Array(total);
    const phases = new Float32Array(total);
    const speeds = new Float32Array(total);
    const drifts = new Float32Array(total);

    nodes.forEach((n, i) => {
      positions[i * 3] = n.x; positions[i * 3 + 1] = n.y; positions[i * 3 + 2] = n.z;
      colors[i * 3] = n.color[0]; colors[i * 3 + 1] = n.color[1]; colors[i * 3 + 2] = n.color[2];
      sizes[i] = 0.031 + (n.stage === 0 ? 0.004 : 0.011);   // world units
      kinds[i] = 0;
      phases[i] = Math.random() * 10;
      speeds[i] = 0;
      drifts[i] = 0;
    });

    /* the dust field: thousands of subtle particles filling the containment shell */
    for (let k = 0; k < dustCount; k++) {
      const i = nodes.length + k;
      const dx = graph.dust[k * 4], dy = graph.dust[k * 4 + 1], dz = graph.dust[k * 4 + 2];
      positions[i * 3] = dx; positions[i * 3 + 1] = dy; positions[i * 3 + 2] = dz;
      const warm = (Math.abs(dx) + Math.abs(dz)) / (SHELL_R * 2);
      colors[i * 3] = 0.30 + warm * 0.18; colors[i * 3 + 1] = 0.38 + warm * 0.22; colors[i * 3 + 2] = 0.78;
      sizes[i] = 0.009 + graph.dust[k * 4 + 3] * 0.008;    // world units: fine starfield
      kinds[i] = 0;
      phases[i] = Math.random() * 10;
      speeds[i] = 0;
      drifts[i] = 0;
    }

    for (let k = 0; k < flowCount; k++) {
      const i = nodes.length + dustCount + k;
      const st = STAGES[k % STAGES.length];
      const a = Math.random() * Math.PI * 2;
      const r = REV_R * (0.98 + Math.random() * 0.06);
      positions[i * 3] = Math.cos(a) * r;
      positions[i * 3 + 1] = (Math.random() - 0.5) * 1.1;
      positions[i * 3 + 2] = Math.sin(a) * r;
      colors[i * 3] = st.rgb[0]; colors[i * 3 + 1] = st.rgb[1]; colors[i * 3 + 2] = st.rgb[2];
      sizes[i] = 0.045 + Math.random() * 0.022;            // prospects: the brightest actors
      kinds[i] = 1;
      phases[i] = Math.random();
      speeds[i] = (0.014 + Math.random() * 0.026) / (mobile ? 1.15 : 1);
      drifts[i] = (Math.random() - 0.5) * 0.6;
    }

    return { positions, colors, sizes, kinds, phases, speeds, drifts };
  }, [graph, mobile]);

  const uniforms = useMemo(() => ({
    uTime: { value: 0 },
    uScale: { value: 1200 },
    uCoreR: { value: CORE_R },
    uFlow: { value: reduced ? 0 : 1 }
  }), [reduced]);

  useFrame((state) => {
    if (!mat.current) return;
    mat.current.uniforms.uTime.value = state.clock.elapsedTime;
    /* world → device-pixel conversion for the live camera and viewport */
    const fov = (state.camera.fov * Math.PI) / 180;
    mat.current.uniforms.uScale.value =
      (state.size.height * state.gl.getPixelRatio()) / (2 * Math.tan(fov / 2));
  });

  return (
    <points frustumCulled={false}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        <bufferAttribute attach="attributes-aColor" args={[colors, 3]} />
        <bufferAttribute attach="attributes-aSize" args={[sizes, 1]} />
        <bufferAttribute attach="attributes-aKind" args={[kinds, 1]} />
        <bufferAttribute attach="attributes-aPhase" args={[phases, 1]} />
        <bufferAttribute attach="attributes-aSpeed" args={[speeds, 1]} />
        <bufferAttribute attach="attributes-aDrift" args={[drifts, 1]} />
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
