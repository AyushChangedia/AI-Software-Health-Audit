'use client';

import { useEffect, useRef } from 'react';
import { useReducedMotion } from 'framer-motion';

/**
 * The hero backdrop: a slowly drifting dependency graph.
 *
 * Canvas rather than DOM nodes so it stays at one composited layer, capped at
 * ~30fps, paused entirely when the tab is hidden or the section is scrolled
 * out of view, and replaced with a still frame when the visitor prefers
 * reduced motion. It is decoration, so it is `aria-hidden` and never focusable.
 */

interface Node {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  /** Slight size/brightness variance so the field does not look mechanical. */
  weight: number;
}

const LINK_DISTANCE = 132;
const POINTER_RADIUS = 170;
const TARGET_FPS = 30;

export function DependencyField({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d', { alpha: true });
    if (!context) return;

    const parent = canvas.parentElement;
    if (!parent) return;

    let nodes: Node[] = [];
    let width = 0;
    let height = 0;
    let dpr = 1;
    let frame = 0;
    let lastDraw = 0;
    let visible = true;
    const pointer = { x: -9_999, y: -9_999, active: false };

    function resize() {
      if (!parent || !canvas || !context) return;
      const rect = parent.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = rect.width;
      height = rect.height;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);

      // Density scaled to area, clamped so phones do not render 400 nodes.
      const count = Math.round(Math.min(90, Math.max(26, (width * height) / 16_000)));
      nodes = Array.from({ length: count }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.16,
        vy: (Math.random() - 0.5) * 0.16,
        radius: 1 + Math.random() * 1.6,
        weight: Math.random(),
      }));
    }

    function draw(now: number) {
      if (!context) return;
      if (now - lastDraw < 1_000 / TARGET_FPS) {
        frame = requestAnimationFrame(draw);
        return;
      }
      lastDraw = now;
      context.clearRect(0, 0, width, height);

      for (const node of nodes) {
        node.x += node.vx;
        node.y += node.vy;

        // Wrap rather than bounce: bouncing reads as a boundary, wrapping reads
        // as a field that continues past the edge of the frame.
        if (node.x < -20) node.x = width + 20;
        if (node.x > width + 20) node.x = -20;
        if (node.y < -20) node.y = height + 20;
        if (node.y > height + 20) node.y = -20;
      }

      // Edges first, so nodes sit on top of them.
      for (let i = 0; i < nodes.length; i += 1) {
        const a = nodes[i]!;
        for (let j = i + 1; j < nodes.length; j += 1) {
          const b = nodes[j]!;
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const distance = Math.hypot(dx, dy);
          if (distance > LINK_DISTANCE) continue;

          const strength = 1 - distance / LINK_DISTANCE;
          const midX = (a.x + b.x) / 2;
          const midY = (a.y + b.y) / 2;
          const pointerDistance = pointer.active
            ? Math.hypot(midX - pointer.x, midY - pointer.y)
            : Number.POSITIVE_INFINITY;
          const excited = pointerDistance < POINTER_RADIUS ? 1 - pointerDistance / POINTER_RADIUS : 0;

          context.strokeStyle = excited
            ? `rgba(150, 135, 255, ${(0.06 + strength * 0.1 + excited * 0.28).toFixed(3)})`
            : `rgba(150, 160, 180, ${(0.03 + strength * 0.07).toFixed(3)})`;
          context.lineWidth = excited > 0.35 ? 1 : 0.7;
          context.beginPath();
          context.moveTo(a.x, a.y);
          context.lineTo(b.x, b.y);
          context.stroke();
        }
      }

      for (const node of nodes) {
        const pointerDistance = pointer.active
          ? Math.hypot(node.x - pointer.x, node.y - pointer.y)
          : Number.POSITIVE_INFINITY;
        const excited = pointerDistance < POINTER_RADIUS ? 1 - pointerDistance / POINTER_RADIUS : 0;

        context.beginPath();
        context.arc(node.x, node.y, node.radius + excited * 1.3, 0, Math.PI * 2);
        context.fillStyle = excited
          ? `rgba(167, 154, 255, ${(0.3 + excited * 0.6).toFixed(3)})`
          : `rgba(160, 170, 190, ${(0.16 + node.weight * 0.2).toFixed(3)})`;
        context.fill();
      }

      frame = requestAnimationFrame(draw);
    }

    function drawStill() {
      if (!context) return;
      context.clearRect(0, 0, width, height);
      for (let i = 0; i < nodes.length; i += 1) {
        const a = nodes[i]!;
        for (let j = i + 1; j < nodes.length; j += 1) {
          const b = nodes[j]!;
          const distance = Math.hypot(a.x - b.x, a.y - b.y);
          if (distance > LINK_DISTANCE) continue;
          context.strokeStyle = `rgba(150, 160, 180, ${(0.05 * (1 - distance / LINK_DISTANCE)).toFixed(3)})`;
          context.lineWidth = 0.7;
          context.beginPath();
          context.moveTo(a.x, a.y);
          context.lineTo(b.x, b.y);
          context.stroke();
        }
      }
      for (const node of nodes) {
        context.beginPath();
        context.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
        context.fillStyle = `rgba(160, 170, 190, ${(0.16 + node.weight * 0.2).toFixed(3)})`;
        context.fill();
      }
    }

    function onPointerMove(event: PointerEvent) {
      const rect = canvas!.getBoundingClientRect();
      pointer.x = event.clientX - rect.left;
      pointer.y = event.clientY - rect.top;
      pointer.active = true;
    }

    function onPointerLeave() {
      pointer.active = false;
    }

    function start() {
      cancelAnimationFrame(frame);
      if (reducedMotion) drawStill();
      else frame = requestAnimationFrame(draw);
    }

    resize();
    start();

    const resizeObserver = new ResizeObserver(() => {
      resize();
      start();
    });
    resizeObserver.observe(parent);

    // Stop burning frames when the field is off screen or the tab is hidden.
    const intersection = new IntersectionObserver(
      ([entry]) => {
        visible = entry?.isIntersecting ?? true;
        if (visible) start();
        else cancelAnimationFrame(frame);
      },
      { threshold: 0 },
    );
    intersection.observe(parent);

    function onVisibility() {
      if (document.hidden) cancelAnimationFrame(frame);
      else if (visible) start();
    }

    document.addEventListener('visibilitychange', onVisibility);
    if (!reducedMotion) {
      parent.addEventListener('pointermove', onPointerMove);
      parent.addEventListener('pointerleave', onPointerLeave);
    }

    return () => {
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      intersection.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      parent.removeEventListener('pointermove', onPointerMove);
      parent.removeEventListener('pointerleave', onPointerLeave);
    };
  }, [reducedMotion]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className={className}
      style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
    />
  );
}
