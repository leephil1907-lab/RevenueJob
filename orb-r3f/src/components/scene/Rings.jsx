/**
 * The five stage rings, drawn explicitly.
 *
 * The nodes alone can read as noise; the rings are what make the order legible —
 * one orbit per pipeline stage, each in its own tilted plane, outer to inner, in
 * the stage colour. Prospects sit on the outermost; revenue sits closest to the
 * core.
 */
import React, { useMemo } from 'react';
import * as THREE from 'three';
import { STAGES, ringPoint } from '../../engine/pipeline.js';

const SEGMENTS = 220;

export default function Rings() {
  const rings = useMemo(() => STAGES.map((st, si) => {
    const pts = new Float32Array((SEGMENTS + 1) * 3);
    for (let i = 0; i <= SEGMENTS; i++) {
      const p = ringPoint(si, (i / SEGMENTS) * Math.PI * 2);
      pts[i * 3] = p.x; pts[i * 3 + 1] = p.y; pts[i * 3 + 2] = p.z;
    }
    return { pts, color: st.color };
  }), []);

  return (
    <group>
      {rings.map((r, i) => (
        <line key={i} frustumCulled={false}>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[r.pts, 3]} />
          </bufferGeometry>
          <lineBasicMaterial
            color={r.color}
            transparent
            opacity={0.46 - i * 0.045}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
          />
        </line>
      ))}
    </group>
  );
}
