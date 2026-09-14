/**
 * The dark, structural shell around the pipeline.
 *
 * Deliberately not a gradient blob: the containment sphere is near-black and
 * translucent so the pipeline reads through it, and it is drawn with real
 * engineering structure (lat/long lattice + wireframe) rather than a glow.
 */
import React, { useMemo } from 'react';
import * as THREE from 'three';
import { SHELL_R } from '../../engine/pipeline.js';

function latLongLines(radius) {
  const pts = [];
  const LAT = 7, SEG = 96;
  for (let i = 1; i <= LAT; i++) {
    const phi = (i / (LAT + 1)) * Math.PI;
    const y = Math.cos(phi) * radius;
    const r = Math.sin(phi) * radius;
    for (let s = 0; s < SEG; s++) {
      const a0 = (s / SEG) * Math.PI * 2, a1 = ((s + 1) / SEG) * Math.PI * 2;
      pts.push(Math.cos(a0) * r, y, Math.sin(a0) * r, Math.cos(a1) * r, y, Math.sin(a1) * r);
    }
  }
  const LON = 12, VSEG = 48;
  for (let j = 0; j < LON; j++) {
    const a = (j / LON) * Math.PI * 2;
    for (let s = 0; s < VSEG; s++) {
      const p0 = (s / VSEG) * Math.PI, p1 = ((s + 1) / VSEG) * Math.PI;
      pts.push(Math.cos(a) * Math.sin(p0) * radius, Math.cos(p0) * radius, Math.sin(a) * Math.sin(p0) * radius);
      pts.push(Math.cos(a) * Math.sin(p1) * radius, Math.cos(p1) * radius, Math.sin(a) * Math.sin(p1) * radius);
    }
  }
  return new Float32Array(pts);
}

export default function Shell() {
  const lines = useMemo(() => latLongLines(SHELL_R), []);

  return (
    <group>
      {/* dark interior — makes the sphere read as a solid, translucent object */}
      <mesh>
        <sphereGeometry args={[SHELL_R, 64, 48]} />
        <meshBasicMaterial
          color="#04060f"
          side={THREE.BackSide}
          transparent
          opacity={0.55}
          depthWrite={false}
        />
      </mesh>

      {/* structural lattice */}
      <lineSegments frustumCulled={false}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[lines, 3]} />
        </bufferGeometry>
        <lineBasicMaterial
          color="#3a4a92"
          transparent
          opacity={0.075}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </lineSegments>

      {/* outer wireframe — gives the boundary an edge without volume */}
      <mesh>
        <icosahedronGeometry args={[SHELL_R * 1.002, 3]} />
        <meshBasicMaterial
          color="#243a86"
          wireframe
          transparent
          opacity={0.05}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}
