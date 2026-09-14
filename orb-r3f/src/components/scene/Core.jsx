/**
 * The AI core — where prospects converge.
 *
 * It is not a lightbulb: it is a dark, dense object (near-black translucent
 * sphere inside a bright wireframe cage, three counter-rotating gyro rings) that
 * *reacts*. Every absorbed prospect flares it; qualified pulses leave a bloom
 * ring behind on their way out. Its brightness is therefore a readout of the
 * pipeline, not a decoration.
 */
import React, { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { CORE_R } from '../../engine/pipeline.js';

const glowVert = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const glowFrag = /* glsl */ `
  uniform float uFlare;
  uniform vec3 uColor;
  varying vec2 vUv;
  void main() {
    float d = length(vUv - 0.5) * 2.0;
    float core = smoothstep(1.0, 0.0, d);
    float a = pow(core, 2.6) * (0.55 + uFlare * 0.5);
    gl_FragColor = vec4(uColor * a, a);
  }
`;

export default function Core({ flare, bloom }) {
  const glowMesh = useRef();
  const glowMat = useRef();
  const cage = useRef();
  const inner = useRef();
  const g1 = useRef();
  const g2 = useRef();
  const g3 = useRef();
  const bloomRef = useRef();

  const glowU = useMemo(() => ({
    uFlare: { value: 0 },
    uColor: { value: new THREE.Color('#6fa8ff') }
  }), []);

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime;
    const f = flare.current;

    /* autonomous motion: every rotation is slow and none of them share an axis */
    if (cage.current) cage.current.rotation.y += delta * 0.14;
    if (inner.current) inner.current.rotation.y -= delta * 0.09;
    if (g1.current) g1.current.rotation.z += delta * 0.22;
    if (g2.current) { g2.current.rotation.x += delta * 0.17; g2.current.rotation.y += delta * 0.1; }
    if (g3.current) { g3.current.rotation.y += delta * 0.13; g3.current.rotation.z -= delta * 0.19; }

    if (glowMat.current) glowMat.current.uniforms.uFlare.value = f;
    if (glowMesh.current) glowMesh.current.quaternion.copy(state.camera.quaternion);  // billboard the glow
    if (inner.current) {
      inner.current.material.emissiveIntensity = 0.22 + f * 1.4 + Math.sin(t * 1.3) * 0.035;
    }
    if (cage.current) cage.current.material.opacity = 0.22 + f * 0.5;

    /* qualified-lead bloom: expands once and fades out */
    if (bloomRef.current) {
      const b = bloom.current;
      if (b.active) {
        b.t += delta * 1.05;
        const s = 1 + b.t * 3.4;
        bloomRef.current.scale.setScalar(s);
        bloomRef.current.material.opacity = Math.max(0, (1 - b.t) * 0.5);
        bloomRef.current.quaternion.copy(state.camera.quaternion);
        if (b.t >= 1) { b.active = false; bloomRef.current.material.opacity = 0; }
      }
    }
  });

  return (
    <group>
      {/* glow, billboarded */}
      <mesh ref={glowMesh} renderOrder={2}>
        <planeGeometry args={[CORE_R * 6.4, CORE_R * 6.4]} />
        <shaderMaterial
          ref={glowMat}
          vertexShader={glowVert}
          fragmentShader={glowFrag}
          uniforms={glowU}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>

      {/* dense dark body — the AI itself reads as an object, not a light */}
      <mesh ref={inner}>
        <sphereGeometry args={[CORE_R * 0.72, 48, 36]} />
        <meshStandardMaterial
          color="#04070f"
          emissive="#3b6fd4"
          emissiveIntensity={0.22}
          metalness={0.85}
          roughness={0.18}
          transparent
          opacity={0.96}
        />
      </mesh>

      {/* bright cage */}
      <mesh ref={cage}>
        <icosahedronGeometry args={[CORE_R * 0.95, 2]} />
        <meshBasicMaterial
          color="#8fb6ff"
          wireframe
          transparent
          opacity={0.24}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>

      {/* gyro rings, each on its own axis */}
      <mesh ref={g1}>
        <torusGeometry args={[CORE_R * 1.5, 0.011, 8, 128]} />
        <meshBasicMaterial color="#5ae7ff" transparent opacity={0.42} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>
      <mesh ref={g2} rotation={[Math.PI / 2.6, 0, 0.4]}>
        <torusGeometry args={[CORE_R * 1.72, 0.009, 8, 128]} />
        <meshBasicMaterial color="#8a6bff" transparent opacity={0.34} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>
      <mesh ref={g3} rotation={[0, 0.9, Math.PI / 3]}>
        <torusGeometry args={[CORE_R * 1.94, 0.008, 8, 128]} />
        <meshBasicMaterial color="#6fa8ff" transparent opacity={0.26} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>

      {/* bloom left behind by a qualified lead leaving the system */}
      <mesh ref={bloomRef} renderOrder={3}>
        <ringGeometry args={[CORE_R * 1.15, CORE_R * 1.22, 96]} />
        <meshBasicMaterial color="#46e3a4" transparent opacity={0} blending={THREE.AdditiveBlending} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}
