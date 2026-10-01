'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { useMotionPreference } from '@/hooks/use-motion-preference';
import { Maximize2, Minus, Plus, Repeat } from 'lucide-react';
import type { ArchitectureMap, ArchNode, ArchNodeKind, Finding } from '@/types';
import { cn, severityColorVar } from '@/lib/utils';
import { Panel } from '@/components/ui/panel';
import { SeverityBadge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/misc';

/**
 * Architecture explorer.
 *
 * The map is derived from the repository — components are file groupings, the
 * edges are real imports, and the external services are inferred from the SDKs
 * the code imports. Risk is projected onto the component that owns the file a
 * finding landed in, so the shape tells you where to look before you read.
 *
 * Pan and zoom are hand-rolled on an SVG viewBox: a graph library would be
 * several hundred kilobytes for behaviour this page can express in a transform.
 */

const WIDTH = 1000;
const HEIGHT = 560;
const NODE_W = 150;
const NODE_H = 58;

const KIND_STYLE: Record<ArchNodeKind, { fill: string; label: string }> = {
  client: { fill: 'var(--color-low)', label: 'Client' },
  edge: { fill: 'var(--color-signal)', label: 'Edge' },
  service: { fill: 'var(--color-validator)', label: 'Service' },
  worker: { fill: 'var(--color-medium)', label: 'Worker' },
  datastore: { fill: 'var(--color-healthy)', label: 'Data' },
  external: { fill: 'var(--color-ink-faint)', label: 'External' },
  infra: { fill: 'var(--color-ink-muted)', label: 'Infra' },
};

function toCanvas(node: ArchNode) {
  return { x: (node.x / 100) * WIDTH, y: (node.y / 100) * HEIGHT };
}

export function ArchitectureExplorer({
  map,
  findings,
  className,
}: {
  map: ArchitectureMap;
  findings: Finding[];
  className?: string;
}) {
  const reducedMotion = useMotionPreference();
  const svgRef = useRef<SVGSVGElement>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const dragState = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const [selected, setSelected] = useState<ArchNode | null>(null);

  const positions = useMemo(
    () => new Map(map.nodes.map((node) => [node.id, toCanvas(node)])),
    [map.nodes],
  );

  const findingById = useMemo(() => new Map(findings.map((f) => [f.id, f])), [findings]);

  const onPointerDown = useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
      if (event.button !== 0) return;
      (event.target as Element).setPointerCapture?.(event.pointerId);
      dragState.current = { x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y };
    },
    [pan],
  );

  const onPointerMove = useCallback((event: React.PointerEvent<SVGSVGElement>) => {
    const state = dragState.current;
    if (!state) return;
    setPan({
      x: state.panX + (event.clientX - state.x),
      y: state.panY + (event.clientY - state.y),
    });
  }, []);

  const endDrag = useCallback(() => {
    dragState.current = null;
  }, []);

  const onWheel = useCallback((event: React.WheelEvent) => {
    if (!event.ctrlKey && !event.metaKey) return; // let the page scroll normally
    event.preventDefault();
    setZoom((current) => Math.min(2.5, Math.max(0.5, current - event.deltaY * 0.002)));
  }, []);

  function reset() {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }

  if (map.nodes.length === 0) {
    return (
      <EmptyState
        title="No architecture detected"
        description="Sentinel groups files into components by path convention. This repository does not use a layout it recognises, so there is nothing meaningful to draw."
        className={className}
      />
    );
  }

  return (
    <div className={cn('grid gap-3 lg:grid-cols-[1fr_320px]', className)}>
      <Panel className="relative overflow-hidden">
        <div className="flex items-center justify-between border-b border-[var(--color-hairline)] px-4 py-3">
          <div className="eyebrow">Component map</div>
          <div className="flex items-center gap-1">
            <IconButton label="Zoom out" onClick={() => setZoom((z) => Math.max(0.5, z - 0.2))}>
              <Minus className="size-3.5" aria-hidden />
            </IconButton>
            <span className="tabular w-11 text-center text-[11px] text-[var(--color-ink-faint)]">
              {Math.round(zoom * 100)}%
            </span>
            <IconButton label="Zoom in" onClick={() => setZoom((z) => Math.min(2.5, z + 0.2))}>
              <Plus className="size-3.5" aria-hidden />
            </IconButton>
            <IconButton label="Reset view" onClick={reset}>
              <Maximize2 className="size-3.5" aria-hidden />
            </IconButton>
          </div>
        </div>

        <div className="relative overflow-hidden bg-[#0a0c0f]">
          <svg
            ref={svgRef}
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            className="h-[420px] w-full cursor-grab touch-none active:cursor-grabbing sm:h-[520px]"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerLeave={endDrag}
            onWheel={onWheel}
            role="img"
            aria-label="Repository architecture map. Use the node list on the right for a text equivalent."
          >
            <defs>
              <pattern id="arch-grid" width="40" height="40" patternUnits="userSpaceOnUse">
                <path d="M 40 0 L 0 0 0 40" fill="none" stroke="var(--color-hairline)" strokeWidth="0.6" />
              </pattern>
              <marker
                id="arch-arrow"
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="5"
                markerHeight="5"
                orient="auto-start-reverse"
              >
                <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--color-hairline-strong)" />
              </marker>
            </defs>

            <rect width={WIDTH} height={HEIGHT} fill="url(#arch-grid)" opacity={0.5} />

            <g transform={`translate(${pan.x} ${pan.y}) scale(${zoom})`}>
              {/* Edges */}
              <g>
                {map.edges.map((edge, index) => {
                  const from = positions.get(edge.from);
                  const to = positions.get(edge.to);
                  if (!from || !to) return null;
                  const risky = Boolean(edge.risk);
                  const midY = (from.y + to.y) / 2;
                  return (
                    <motion.path
                      key={`${edge.from}-${edge.to}-${index}`}
                      d={`M ${from.x} ${from.y} C ${from.x} ${midY}, ${to.x} ${midY}, ${to.x} ${to.y}`}
                      fill="none"
                      stroke={
                        risky
                          ? `color-mix(in oklab, ${severityColorVar(edge.risk!)} 45%, transparent)`
                          : 'var(--color-hairline-strong)'
                      }
                      strokeWidth={risky ? 1.6 : 1.1}
                      markerEnd="url(#arch-arrow)"
                      initial={reducedMotion ? false : { pathLength: 0, opacity: 0 }}
                      animate={{ pathLength: 1, opacity: 1 }}
                      transition={{ delay: index * 0.02, duration: 0.5 }}
                    />
                  );
                })}
              </g>

              {/* Nodes */}
              {map.nodes.map((node, index) => {
                const position = positions.get(node.id)!;
                const style = KIND_STYLE[node.kind];
                const risk = node.risk;
                const active = selected?.id === node.id;
                return (
                  <motion.g
                    key={node.id}
                    initial={reducedMotion ? false : { opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: 0.1 + index * 0.03, duration: 0.3 }}
                    style={{ transformOrigin: `${position.x}px ${position.y}px`, cursor: 'pointer' }}
                    onClick={() => setSelected(node)}
                    tabIndex={0}
                    role="button"
                    aria-label={`${node.label}: ${node.files.length} files, ${node.findingIds.length} findings`}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        setSelected(node);
                      }
                    }}
                  >
                    <rect
                      x={position.x - NODE_W / 2}
                      y={position.y - NODE_H / 2}
                      width={NODE_W}
                      height={NODE_H}
                      rx={10}
                      fill="var(--color-panel)"
                      stroke={
                        active
                          ? 'var(--color-ink)'
                          : risk
                            ? severityColorVar(risk)
                            : 'var(--color-hairline-strong)'
                      }
                      strokeWidth={active ? 2 : risk ? 1.5 : 1}
                    />
                    <rect
                      x={position.x - NODE_W / 2}
                      y={position.y - NODE_H / 2}
                      width={4}
                      height={NODE_H}
                      rx={2}
                      fill={risk ? severityColorVar(risk) : style.fill}
                    />
                    <text
                      x={position.x - NODE_W / 2 + 16}
                      y={position.y - 6}
                      fontSize={13}
                      fontWeight={600}
                      fill="var(--color-ink)"
                    >
                      {node.label}
                    </text>
                    <text
                      x={position.x - NODE_W / 2 + 16}
                      y={position.y + 12}
                      fontSize={10.5}
                      fill="var(--color-ink-faint)"
                    >
                      {node.kind === 'external'
                        ? style.label
                        : `${node.files.length} files · ${node.findingIds.length} findings`}
                    </text>
                  </motion.g>
                );
              })}
            </g>
          </svg>

          <p className="pointer-events-none absolute bottom-3 left-4 text-[11px] text-[var(--color-ink-faint)]">
            Drag to pan · ⌘/Ctrl + scroll to zoom
          </p>
        </div>
      </Panel>

      <div className="space-y-3">
        {map.cycles.length > 0 ? (
          <Panel className="border-[color-mix(in_oklab,var(--color-high)_35%,transparent)] p-4">
            <h3 className="flex items-center gap-2 text-[13px] font-semibold">
              <Repeat className="size-4 text-[var(--color-high)]" aria-hidden />
              {map.cycles.length} dependency {map.cycles.length === 1 ? 'cycle' : 'cycles'}
            </h3>
            <ul className="mt-2.5 space-y-1.5">
              {map.cycles.slice(0, 4).map((cycle, index) => (
                <li key={index} className="mono text-[var(--color-ink-muted)]">
                  {[...cycle, cycle[0]].join(' → ')}
                </li>
              ))}
            </ul>
            <p className="mt-2.5 text-[11px] leading-relaxed text-[var(--color-ink-faint)]">
              Cycles inside a single component are shown as file names; cycles that cross a
              boundary are shown as components.
            </p>
          </Panel>
        ) : null}

        <Panel className="overflow-hidden">
          <div className="border-b border-[var(--color-hairline)] px-4 py-3">
            <div className="eyebrow">{selected ? selected.label : 'Components'}</div>
          </div>

          {selected ? (
            <div className="px-4 py-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded border border-[var(--color-hairline)] px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-[var(--color-ink-faint)]">
                  {KIND_STYLE[selected.kind].label}
                </span>
                {selected.risk ? <SeverityBadge severity={selected.risk} size="sm" /> : null}
              </div>

              {selected.description ? (
                <p className="mt-3 text-pretty text-[13px] leading-relaxed text-[var(--color-ink-muted)]">
                  {selected.description}
                </p>
              ) : null}

              {selected.findingIds.length > 0 ? (
                <div className="mt-4">
                  <div className="eyebrow mb-2">
                    {selected.findingIds.length} findings here
                  </div>
                  <ul className="space-y-1.5">
                    {selected.findingIds.slice(0, 6).map((id) => {
                      const finding = findingById.get(id);
                      if (!finding) return null;
                      return (
                        <li key={id} className="flex items-start gap-2 text-[12px]">
                          <span
                            aria-hidden
                            className="mt-1.5 size-1.5 shrink-0 rounded-full"
                            style={{ backgroundColor: severityColorVar(finding.severity) }}
                          />
                          <span className="min-w-0 flex-1 text-[var(--color-ink-muted)]">
                            {finding.title}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ) : null}

              <div className="mt-4">
                <div className="eyebrow mb-2">Files</div>
                <ul className="max-h-48 space-y-1 overflow-y-auto">
                  {selected.files.slice(0, 30).map((file) => (
                    <li key={file} className="mono truncate text-[var(--color-ink-faint)]">
                      {file}
                    </li>
                  ))}
                </ul>
              </div>

              <button
                type="button"
                onClick={() => setSelected(null)}
                className="mt-4 text-[12px] text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
              >
                ← Back to all components
              </button>
            </div>
          ) : (
            <ul className="divide-y divide-[var(--color-hairline)]">
              {map.nodes.map((node) => (
                <li key={node.id}>
                  <button
                    type="button"
                    onClick={() => setSelected(node)}
                    className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-[var(--color-raised)]"
                  >
                    <span
                      aria-hidden
                      className="size-2 shrink-0 rounded-full"
                      style={{
                        backgroundColor: node.risk
                          ? severityColorVar(node.risk)
                          : KIND_STYLE[node.kind].fill,
                      }}
                    />
                    <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
                      {node.label}
                    </span>
                    <span className="tabular shrink-0 text-[11px] text-[var(--color-ink-faint)]">
                      {node.kind === 'external' ? 'external' : `${node.findingIds.length}`}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}

function IconButton({
  children,
  label,
  onClick,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="inline-flex size-7 items-center justify-center rounded-md text-[var(--color-ink-muted)] transition-colors hover:bg-[var(--color-raised)] hover:text-[var(--color-ink)]"
    >
      {children}
    </button>
  );
}
