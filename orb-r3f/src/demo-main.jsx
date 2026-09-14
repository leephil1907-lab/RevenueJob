/**
 * Standalone mount for orb-demo.html — the same components the app uses, with a
 * small readout so the pipeline can be verified by watching it, not by trusting it.
 */
import React, { useCallback, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import HeroOrb from './HeroOrb.jsx';

/* the pipeline, in words — same order as the rings, outer to inner */
const STAGE_COPY = [
  ['Prospects', 'Agents find and enrich accounts that match your market, continuously.'],
  ['Intelligence', 'Every prospect is researched and scored before anyone reaches out.'],
  ['Conversations', 'Outreach runs in your voice, and the agent answers what comes back.'],
  ['Opportunities', 'Qualified interest becomes a tracked deal with a reason it is worth pursuing.'],
  ['Revenue', 'Closed and influenced revenue is attributed back to what actually produced it.']
];

function Readout({ s }) {
  const rows = [
    ['Prospects in the system', (s.nodes ?? 0).toLocaleString('en-US')],
    ['Connection segments', (s.edges ?? 0).toLocaleString('en-US')],
    ['Particles in the shell', (s.dust ?? 0).toLocaleString('en-US')],
    ['Data pulses sent', s.pulses ?? 0],
    ['Pulses that changed connection', s.hops ?? 0],
    ['Absorbed by the AI core', s.absorbed ?? 0],
    ['Qualified leads sent out', s.qualified ?? 0],
    ['Camera distance', (s.camDist ?? 12.4).toFixed(2)],
    ['Autonomous rotation', ((s.turns ?? 0) * 57.3).toFixed(0) + '°'],
    ['Scroll progress', Math.round((s.scroll ?? 0) * 100) + '%']
  ];
  return (
    <dl className="readout">
      {rows.map(([k, v]) => (
        <div key={k}><dt>{k}</dt><dd>{v}</dd></div>
      ))}
    </dl>
  );
}

function StageList() {
  return (
    <div className="stage-list">
      {STAGE_COPY.map(([k, v], i) => (
        <div key={k}><b>{String(i + 1).padStart(2, '0')} {k}</b><span>{v}</span></div>
      ))}
    </div>
  );
}

function Demo() {
  const [stats, setStats] = useState({});
  const [staticMode, setStaticMode] = useState(false);
  const last = useRef(0);
  /* throttle HUD updates: the readout must never cost frames */
  const onStats = useCallback((s) => {
    const now = performance.now();
    if (now - last.current < 200) return;
    last.current = now;
    setStats(s);
  }, []);

  return (
    <>
      <div className="stage">
        <HeroOrb onStats={onStats} forceReduced={staticMode} />
        <span className="engine-tag" data-mode={staticMode ? 'static' : 'live'}>
          {staticMode ? 'Tier 0 · SVG fallback' : 'Tier 2 · WebGL · Three.js'}
        </span>
      </div>
      <Readout s={staticMode ? {} : stats} />
      <button className="toggle" onClick={() => setStaticMode(v => !v)}>
        {staticMode ? 'Show the WebGL engine' : 'Show the reduced-motion fallback'}
      </button>
    </>
  );
}

createRoot(document.getElementById('orb-root')).render(<Demo />);
createRoot(document.getElementById('stages-root')).render(<StageList />);
