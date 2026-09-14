/**
 * Motion & interaction: slow autonomous rotation, scroll-driven camera, damped
 * pointer parallax on desktop, drag-to-turn on touch.
 *
 * Rules carried over from the site's motion direction: nothing is linear, the
 * scroll response is a parallax (the orb must not hijack the page), and the
 * touch path is a different interaction (drag to turn) rather than a shrunk
 * version of the hover path.
 */
import React, { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

export default function Rig({ root, mobile = false, reduced = false, onStats }) {
  const { camera, gl } = useThree();
  const target = useRef({ x: 0, y: 0 });
  const drag = useRef({ active: false, x: 0, y: 0, vx: 0, vy: 0, spin: 0, tilt: 0 });
  const scroll = useRef(0);
  const cur = useRef({ spin: 0, tilt: 0, scroll: 0 });

  /* scroll progress of the whole page, read passively (never blocks scrolling) */
  useEffect(() => {
    const onScroll = () => {
      const doc = document.documentElement;
      const max = Math.max(1, (doc.scrollHeight || 0) - window.innerHeight);
      scroll.current = Math.min(1, Math.max(0, (window.scrollY || 0) / max));
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, []);

  /* pointer / touch — attached to the canvas element, all listeners passive */
  useEffect(() => {
    const el = gl.domElement;
    if (!el) return;

    const down = (e) => {
      if (e.pointerType === 'touch' || mobile) {
        drag.current.active = true;
        drag.current.x = e.clientX;
        drag.current.y = e.clientY;
        drag.current.vx = 0;
        drag.current.vy = 0;
      }
    };
    const move = (e) => {
      const r = el.getBoundingClientRect();
      const nx = ((e.clientX - r.left) / r.width) * 2 - 1;
      const ny = ((e.clientY - r.top) / r.height) * 2 - 1;
      target.current.x = Math.max(-1, Math.min(1, nx));
      target.current.y = Math.max(-1, Math.min(1, ny));

      if (drag.current.active) {
        const dx = e.clientX - drag.current.x;
        const dy = e.clientY - drag.current.y;
        drag.current.x = e.clientX;
        drag.current.y = e.clientY;
        drag.current.vx = dx * 0.0055;
        drag.current.vy = dy * 0.0032;
        drag.current.spin += drag.current.vx;
        drag.current.tilt += drag.current.vy;
      }
    };
    const up = () => { drag.current.active = false; };

    el.addEventListener('pointerdown', down, { passive: true });
    el.addEventListener('pointermove', move, { passive: true });
    el.addEventListener('pointerup', up, { passive: true });
    el.addEventListener('pointercancel', up, { passive: true });
    el.addEventListener('pointerleave', up, { passive: true });
    return () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      el.removeEventListener('pointerleave', up);
    };
  }, [gl, mobile]);

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.05);
    const c = cur.current;

    /* damped easing — exponential approach, never a linear ramp */
    c.scroll += (scroll.current - c.scroll) * (1 - Math.pow(0.0016, dt));
    c.spin += (drag.current.spin - c.spin) * (1 - Math.pow(0.002, dt));
    c.tilt += (drag.current.tilt - c.tilt) * (1 - Math.pow(0.002, dt));
    drag.current.spin *= Math.pow(0.86, dt * 60);      // fling decays
    drag.current.tilt *= Math.pow(0.86, dt * 60);

    if (root.current) {
      if (!reduced) root.current.rotation.y += dt * 0.052;    // slow autonomous turn
      root.current.rotation.y += c.spin * dt * 2.4;
      root.current.rotation.x = c.tilt * 0.5 + Math.sin(state.clock.elapsedTime * 0.11) * 0.012;
      /* desktop pointer parallax */
      if (!mobile) {
        root.current.rotation.x += target.current.y * 0.045;
        root.current.rotation.z += -target.current.x * 0.02;
      }
    }

    /* scroll-driven camera: pushes in and lifts as the page descends */
    const s = c.scroll;
    const z = 12.4 + (9.6 - 12.4) * s;
    const y = 1.5 + (3.9 - 1.5) * s;
    camera.position.z += (z - camera.position.z) * (1 - Math.pow(0.02, dt));
    camera.position.y += (y - camera.position.y) * (1 - Math.pow(0.02, dt));
    if (!mobile) {
      camera.position.x += (target.current.x * 0.55 - camera.position.x) * (1 - Math.pow(0.05, dt));
    }
    camera.lookAt(0, 0, 0);

    if (onStats) onStats({
      scroll: s,
      spin: c.spin,
      camDist: camera.position.z,
      camY: camera.position.y,
      turns: root.current ? root.current.rotation.y : 0
    });
  });

  return null;
}
