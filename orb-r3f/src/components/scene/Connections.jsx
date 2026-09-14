/**
 * The connection graph — the pipeline's visible wiring.
 *
 * Each segment is faint on its own; a highlight travels along every one of them
 * on its own phase, which is what makes the network read as *carrying* data
 * rather than being a static web of lines. Edge direction is always inward
 * (stage → next stage), so the flow direction on screen is the pipeline order.
 */
import React, { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { STAGES } from '../../engine/pipeline.js';

const vert = /* glsl */ `
  attribute float aAlong;      // 0 at the segment start, 1 at its end
  attribute float aPhase;      // per-segment offset so highlights are not synchronised
  attribute vec3 aColor;
  attribute float aWeight;     // long-range links are dimmer than local ones
  varying float vAlong;
  varying float vPhase;
  varying vec3 vColor;
  varying float vWeight;

  void main() {
    vAlong = aAlong;
    vPhase = aPhase;
    vColor = aColor;
    vWeight = aWeight;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const frag = /* glsl */ `
  uniform float uTime;
  uniform float uSpeed;
  uniform float uGain;
  varying float vAlong;
  varying float vPhase;
  varying vec3 vColor;
  varying float vWeight;

  void main() {
    float head = fract(uTime * uSpeed + vPhase);
    float d = abs(vAlong - head);
    d = min(d, 1.0 - d);                       // wrap so the head crosses the seam cleanly
    float pulse = smoothstep(0.20, 0.0, d);
    float a = (0.15 + pulse * uGain) * vWeight;
    gl_FragColor = vec4(vColor * a, a);        // additive blending: rgb carries the light
  }
`;

export default function Connections({ graph }) {
  const mat = useRef();

  const { positions, along, phases, colors, weights } = useMemo(() => {
    const n = graph.edges.length;
    const positions = new Float32Array(n * 6);
    const along = new Float32Array(n * 2);
    const phases = new Float32Array(n * 2);
    const colors = new Float32Array(n * 6);
    const weights = new Float32Array(n * 2);

    graph.edges.forEach((e, i) => {
      const o = i * 6;
      positions[o] = e.a[0]; positions[o + 1] = e.a[1]; positions[o + 2] = e.a[2];
      positions[o + 3] = e.b[0]; positions[o + 4] = e.b[1]; positions[o + 5] = e.b[2];
      const col = STAGES[e.stage].rgb;
      colors[o] = col[0]; colors[o + 1] = col[1]; colors[o + 2] = col[2];
      colors[o + 3] = col[0]; colors[o + 4] = col[1]; colors[o + 5] = col[2];
      along[i * 2] = 0; along[i * 2 + 1] = 1;
      /* one travelling highlight per segment, seeded from geometry so it is stable */
      const ph = (e.rMid * 0.37 + i * 0.019) % 1;
      phases[i * 2] = ph; phases[i * 2 + 1] = ph;
      weights[i * 2] = e.skip ? 0.32 : 1; weights[i * 2 + 1] = e.skip ? 0.32 : 1;
    });

    return { positions, along, phases, colors, weights };
  }, [graph]);

  const uniforms = useMemo(() => ({
    uTime: { value: 0 },
    uSpeed: { value: 0.045 },
    uGain: { value: 0.72 }
  }), []);

  useFrame((state) => {
    if (mat.current) mat.current.uniforms.uTime.value = state.clock.elapsedTime;
  });

  return (
    <lineSegments frustumCulled={false}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        <bufferAttribute attach="attributes-aAlong" args={[along, 1]} />
        <bufferAttribute attach="attributes-aPhase" args={[phases, 1]} />
        <bufferAttribute attach="attributes-aColor" args={[colors, 3]} />
        <bufferAttribute attach="attributes-aWeight" args={[weights, 1]} />
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
    </lineSegments>
  );
}
