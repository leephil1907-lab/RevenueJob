/**
 * Tier-0 fallback — pure SVG, zero dependencies, zero JavaScript required.
 *
 * This is the same pipeline seen from the same angle: five stage rings, nodes,
 * connections converging on the AI core, and a qualified pulse on its way out.
 * It is what ships when WebGL is missing, when the user prefers reduced motion,
 * and in the window before the lazy chunk resolves. It is the hero, not a
 * placeholder for one.
 */
import React from 'react';

const STAGES = [
  { key: 'Prospects', r: 168, color: '#6fa8ff' },
  { key: 'Intelligence', r: 145, color: '#8a6bff' },
  { key: 'Conversations', r: 122, color: '#5ae7ff' },
  { key: 'Opportunities', r: 99, color: '#46e3a4' },
  { key: 'Revenue', r: 77, color: '#eafcff' }
];

/* deterministic node placement so SSR and client agree */
function nodes(stageIndex, count) {
  const r = STAGES[stageIndex].r;
  const out = [];
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + stageIndex * 0.6;
    const rr = r + ((i * 37) % 11) - 5;
    out.push([200 + Math.cos(a) * rr, 200 + Math.sin(a) * rr * 0.5]);
  }
  return out;
}

export default function OrbFallback({ label = 'Static · reduced motion', className = '' }) {
  const rings = STAGES.map((s, i) => ({ ...s, cy: 200, rx: s.r, ry: s.r * 0.5 }));

  return (
    <div className={`orb-fallback ${className}`.trim()} role="img"
      aria-label="RevenuePilot pipeline: prospects enter, are qualified through intelligence and conversations, become opportunities, and leave as revenue">
      <svg viewBox="0 0 400 400" width="100%" height="100%" aria-hidden="true">
        <defs>
          <radialGradient id="rp-core" cx="50%" cy="50%">
            <stop offset="0%" stopColor="#cfe4ff" stopOpacity="0.95" />
            <stop offset="45%" stopColor="#6fa8ff" stopOpacity="0.55" />
            <stop offset="100%" stopColor="#6fa8ff" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="rp-vignette" cx="50%" cy="50%">
            <stop offset="62%" stopColor="#050813" stopOpacity="0" />
            <stop offset="100%" stopColor="#050813" stopOpacity="0.55" />
          </radialGradient>
        </defs>

        {/* containment shell */}
        <circle cx="200" cy="200" r="182" fill="url(#rp-vignette)" />
        <circle cx="200" cy="200" r="180" fill="none" stroke="#2a3a7a" strokeWidth="1" opacity="0.35" />

        {/* connections: outer stages feed inner stages */}
        {rings.slice(0, -1).map((s, i) => {
          const inner = rings[i + 1];
          return [0, 1, 2, 3, 4, 5].map(k => {
            const a0 = (k / 6) * Math.PI * 2 + i * 0.5;
            const a1 = a0 + 0.42;
            return (
              <line key={`c${i}-${k}`}
                x1={200 + Math.cos(a0) * s.rx} y1={200 + Math.sin(a0) * s.ry}
                x2={200 + Math.cos(a1) * inner.rx} y2={200 + Math.sin(a1) * inner.ry}
                stroke={s.color} strokeWidth="0.7" opacity="0.30" />
            );
          });
        })}

        {/* stage rings + nodes */}
        {rings.map((s, i) => (
          <g key={s.key}>
            <ellipse cx="200" cy="200" rx={s.rx} ry={s.ry} fill="none"
              stroke={s.color} strokeWidth="1.1" opacity={0.42 - i * 0.04} />
            {nodes(i, 12 - i).map(([x, y], k) => (
              <circle key={k} cx={x} cy={y} r={i < 2 ? 1.9 : 2.3} fill={s.color} opacity={0.75 - i * 0.05} />
            ))}
          </g>
        ))}

        {/* prospect entering from the boundary */}
        <circle cx="368" cy="200" r="3.4" fill="#5ae7ff" opacity="0.9" />
        <line x1="368" y1="200" x2="285" y2="200" stroke="#5ae7ff" strokeWidth="1" opacity="0.45" strokeDasharray="4 6" />

        {/* qualified lead leaving */}
        <line x1="92" y1="200" x2="30" y2="200" stroke="#46e3a4" strokeWidth="1.2" opacity="0.55" strokeDasharray="5 7" />
        <circle cx="34" cy="200" r="3" fill="#46e3a4" opacity="0.95" />

        {/* AI core */}
        <circle cx="200" cy="200" r="46" fill="url(#rp-core)" />
        <circle cx="200" cy="200" r="22" fill="#070d1f" stroke="#8fb6ff" strokeWidth="1.1" opacity="0.9" />
        <circle cx="200" cy="200" r="30" fill="none" stroke="#6fa8ff" strokeWidth="0.8" opacity="0.5" />
        <text x="200" y="203" textAnchor="middle" fontSize="9" fill="#cfe4ff" opacity="0.85"
          fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace">AI</text>
      </svg>

      <span className="orb-badge-fallback">{label}</span>
    </div>
  );
}
