'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useMotionPreference } from '@/hooks/use-motion-preference';
import type { AgentId, AgentRun, AgentState, Severity } from '@/types';
import { AGENTS, WORKER_AGENT_IDS } from '@/lib/constants';
import { severityColorVar } from '@/lib/utils';

/**
 * The agent constellation.
 *
 * Orchestrator at the top, the eight worker agents across the middle, the
 * validator at the bottom. Connections draw in as agents are deployed, and a
 * pulse travels the worker→validator edge each time a finding is raised, so
 * the motion always corresponds to something that happened rather than running
 * on a timer.
 *
 * Hidden below `lg`, where the agent cards carry the same information without
 * needing 960px of horizontal space.
 */

const VIEW_W = 960;
const VIEW_H = 430;
const ORCHESTRATOR = { x: VIEW_W / 2, y: 52 };
const VALIDATOR = { x: VIEW_W / 2, y: 368 };
const WORKER_Y = 208;

interface Pulse {
  id: number;
  agentId: AgentId;
  severity: Severity;
}

function workerPosition(index: number) {
  const count = WORKER_AGENT_IDS.length;
  const usable = VIEW_W - 130;
  return { x: 65 + (usable / (count - 1)) * index, y: WORKER_Y };
}

/** Quadratic curve with the control point pulled toward the vertical midline. */
function curve(from: { x: number; y: number }, to: { x: number; y: number }) {
  const midY = (from.y + to.y) / 2;
  return `M ${from.x} ${from.y} C ${from.x} ${midY}, ${to.x} ${midY}, ${to.x} ${to.y}`;
}

const STATE_COLOR: Record<AgentState, string> = {
  idle: 'var(--color-ink-faint)',
  scanning: 'var(--color-signal)',
  thinking: 'var(--color-signal)',
  found: 'var(--color-high)',
  validating: 'var(--color-validator)',
  complete: 'var(--color-healthy)',
  error: 'var(--color-critical)',
};

export function AgentConstellation({
  agents,
  findingCount,
  className,
}: {
  agents: Record<AgentId, AgentRun>;
  /** Total findings emitted so far; a change fires a pulse. */
  findingCount: number;
  className?: string;
}) {
  const reducedMotion = useMotionPreference();
  const [pulses, setPulses] = useState<Pulse[]>([]);
  const pulseId = useRef(0);
  const previousCounts = useRef<Partial<Record<AgentId, number>>>({});

  // Fire a pulse for whichever agent's finding count went up.
  useEffect(() => {
    if (reducedMotion) return;
    const added: Pulse[] = [];
    for (const id of WORKER_AGENT_IDS) {
      const current = agents[id]?.findingCount ?? 0;
      const previous = previousCounts.current[id] ?? 0;
      if (current > previous) {
        pulseId.current += 1;
        added.push({ id: pulseId.current, agentId: id, severity: 'medium' });
      }
      previousCounts.current[id] = current;
    }
    if (added.length === 0) return;
    setPulses((current) => [...current, ...added].slice(-12));
    const timer = setTimeout(() => {
      setPulses((current) => current.filter((pulse) => !added.some((a) => a.id === pulse.id)));
    }, 1_400);
    return () => clearTimeout(timer);
  }, [findingCount, agents, reducedMotion]);

  const workers = useMemo(
    () => WORKER_AGENT_IDS.map((id, index) => ({ id, ...workerPosition(index) })),
    [],
  );

  const anyActive = workers.some((w) => agents[w.id]?.state !== 'idle');

  return (
    <div className={className}>
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        className="h-auto w-full"
        role="img"
        aria-label="Agent topology: orchestrator, eight analysis agents and the validator"
      >
        <defs>
          <radialGradient id="node-glow">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.35" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* Orchestrator → workers */}
        <g fill="none">
          {workers.map((worker, index) => {
            const path = curve(ORCHESTRATOR, { x: worker.x, y: worker.y - 26 });
            const active = agents[worker.id]?.state !== 'idle';
            return (
              <motion.path
                key={`o-${worker.id}`}
                d={path}
                stroke={active ? 'color-mix(in oklab, var(--color-signal) 45%, transparent)' : 'var(--color-hairline)'}
                strokeWidth={1.2}
                initial={reducedMotion ? false : { pathLength: 0, opacity: 0 }}
                animate={{ pathLength: 1, opacity: 1 }}
                transition={{ delay: 0.1 + index * 0.05, duration: 0.6, ease: 'easeOut' }}
              />
            );
          })}
        </g>

        {/* Workers → validator */}
        <g fill="none">
          {workers.map((worker, index) => {
            const path = curve({ x: worker.x, y: worker.y + 26 }, VALIDATOR);
            const found = (agents[worker.id]?.findingCount ?? 0) > 0;
            return (
              <motion.path
                key={`v-${worker.id}`}
                id={`edge-${worker.id}`}
                d={path}
                stroke={
                  found
                    ? 'color-mix(in oklab, var(--color-validator) 40%, transparent)'
                    : 'var(--color-hairline)'
                }
                strokeWidth={1.2}
                strokeDasharray={found ? undefined : '3 5'}
                initial={reducedMotion ? false : { pathLength: 0, opacity: 0 }}
                animate={{ pathLength: 1, opacity: anyActive ? 1 : 0.5 }}
                transition={{ delay: 0.35 + index * 0.05, duration: 0.6, ease: 'easeOut' }}
              />
            );
          })}
        </g>

        {/* Finding pulses travelling to the validator */}
        {pulses.map((pulse) => (
          <circle key={pulse.id} r={3.5} fill={severityColorVar(pulse.severity)} opacity={0.9}>
            <animateMotion dur="1.2s" fill="freeze" begin="0s">
              <mpath href={`#edge-${pulse.agentId}`} />
            </animateMotion>
            <animate attributeName="opacity" values="0;1;1;0" dur="1.2s" fill="freeze" />
          </circle>
        ))}

        <Node
          x={ORCHESTRATOR.x}
          y={ORCHESTRATOR.y}
          agentId="orchestrator"
          run={agents.orchestrator}
          radius={26}
          reducedMotion={Boolean(reducedMotion)}
        />

        {workers.map((worker, index) => (
          <Node
            key={worker.id}
            x={worker.x}
            y={worker.y}
            agentId={worker.id}
            run={agents[worker.id]}
            radius={24}
            delay={index * 0.06}
            reducedMotion={Boolean(reducedMotion)}
          />
        ))}

        <Node
          x={VALIDATOR.x}
          y={VALIDATOR.y}
          agentId="validator"
          run={agents.validator}
          radius={26}
          reducedMotion={Boolean(reducedMotion)}
        />
      </svg>
    </div>
  );
}

function Node({
  x,
  y,
  agentId,
  run,
  radius,
  delay = 0,
  reducedMotion,
}: {
  x: number;
  y: number;
  agentId: AgentId;
  run: AgentRun | undefined;
  radius: number;
  delay?: number;
  reducedMotion: boolean;
}) {
  const meta = AGENTS[agentId];
  const state = run?.state ?? 'idle';
  const color = STATE_COLOR[state];
  const active = state === 'scanning' || state === 'thinking' || state === 'validating';
  const progress = run?.progress ?? 0;
  const circumference = 2 * Math.PI * (radius + 5);

  return (
    <motion.g
      initial={reducedMotion ? false : { opacity: 0, scale: 0.7 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay, type: 'spring', stiffness: 260, damping: 22 }}
      style={{ transformOrigin: `${x}px ${y}px` }}
    >
      {active && !reducedMotion ? (
        // Animate `scale`, not the `r` attribute: transforms are composited,
        // and animating an SVG geometry attribute forces a layout per frame.
        <motion.circle
          cx={x}
          cy={y}
          r={radius + 8}
          fill={color}
          animate={{ scale: [1, 1.22, 1], opacity: [0.16, 0.04, 0.16] }}
          transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut' }}
          style={{ transformOrigin: `${x}px ${y}px`, opacity: 0.16 }}
        />
      ) : null}

      {/* Progress ring */}
      <circle cx={x} cy={y} r={radius + 5} fill="none" stroke="var(--color-hairline)" strokeWidth={2} />
      <motion.circle
        cx={x}
        cy={y}
        r={radius + 5}
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeDasharray={circumference}
        transform={`rotate(-90 ${x} ${y})`}
        initial={false}
        animate={{ strokeDashoffset: circumference * (1 - (state === 'complete' ? 1 : progress)) }}
        transition={{ duration: 0.5, ease: 'easeOut' }}
      />

      <circle cx={x} cy={y} r={radius} fill="var(--color-panel)" stroke="var(--color-hairline-strong)" strokeWidth={1} />
      <text
        x={x}
        y={y + 1}
        textAnchor="middle"
        dominantBaseline="middle"
        fontSize={20}
        style={{ userSelect: 'none' }}
      >
        {meta.emoji}
      </text>

      <text
        x={x}
        y={y + radius + 22}
        textAnchor="middle"
        fontSize={11}
        fontWeight={600}
        fill="var(--color-ink)"
      >
        {meta.name.replace(' Agent', '')}
      </text>
      <text x={x} y={y + radius + 36} textAnchor="middle" fontSize={10} fill={color}>
        {state === 'idle' ? 'waiting' : state}
      </text>
      {run && run.findingCount > 0 ? (
        <g>
          <circle cx={x + radius - 2} cy={y - radius + 2} r={9} fill="var(--color-high)" />
          <text
            x={x + radius - 2}
            y={y - radius + 3}
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize={10}
            fontWeight={700}
            fill="#1a1204"
          >
            {run.findingCount > 99 ? '99+' : run.findingCount}
          </text>
        </g>
      ) : null}
    </motion.g>
  );
}

/* ------------------------------------------------------------------ */
/* Cards — the same information, at any width                          */
/* ------------------------------------------------------------------ */

const STATE_LABEL: Record<AgentState, string> = {
  idle: 'WAITING',
  scanning: 'SCANNING',
  thinking: 'THINKING',
  found: 'FOUND',
  validating: 'VALIDATING',
  complete: 'COMPLETE',
  error: 'ERROR',
};

export function AgentCard({ run }: { run: AgentRun }) {
  const reducedMotion = useMotionPreference();
  const meta = AGENTS[run.agentId];
  const color = STATE_COLOR[run.state];
  const active = run.state === 'scanning' || run.state === 'thinking' || run.state === 'validating';

  return (
    <div
      className="panel relative overflow-hidden p-4"
      style={
        active
          ? { boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${color} 30%, transparent)` }
          : undefined
      }
    >
      {active && !reducedMotion ? (
        <motion.span
          aria-hidden
          className="absolute inset-x-0 top-0 h-px"
          style={{ background: `linear-gradient(90deg, transparent, ${color}, transparent)` }}
          animate={{ x: ['-100%', '100%'] }}
          transition={{ duration: 2.4, repeat: Infinity, ease: 'linear' }}
        />
      ) : null}

      <div className="flex items-start gap-2.5">
        <span aria-hidden className="text-base leading-none">
          {meta.emoji}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <h3 className="truncate text-[13px] font-semibold tracking-tight">{meta.name}</h3>
            <span
              className="shrink-0 text-[10px] font-bold tracking-[0.1em]"
              style={{ color }}
              aria-live="polite"
            >
              {STATE_LABEL[run.state]}
            </span>
          </div>

          <p className="mt-1.5 line-clamp-2 min-h-[32px] text-[12px] leading-relaxed text-[var(--color-ink-muted)]">
            {run.activity}
            {active && !reducedMotion ? <AnimatedEllipsis /> : null}
          </p>

          <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-[var(--color-hairline)]">
            <motion.div
              className="h-full rounded-full"
              style={{ backgroundColor: color }}
              initial={false}
              animate={{ width: `${Math.round((run.state === 'complete' ? 1 : run.progress) * 100)}%` }}
              transition={{ duration: 0.4, ease: 'easeOut' }}
            />
          </div>

          <dl className="mt-2.5 flex items-center justify-between text-[11px] text-[var(--color-ink-faint)]">
            <div className="flex gap-1.5">
              <dt>Files</dt>
              <dd className="tabular font-medium text-[var(--color-ink-muted)]">
                {run.filesScanned.toLocaleString('en-US')}
              </dd>
            </div>
            <div className="flex gap-1.5">
              <dt>Findings</dt>
              <dd
                className="tabular font-medium"
                style={{ color: run.findingCount > 0 ? 'var(--color-high)' : 'var(--color-ink-muted)' }}
              >
                {run.findingCount}
              </dd>
            </div>
          </dl>
        </div>
      </div>
    </div>
  );
}

function AnimatedEllipsis() {
  const [dots, setDots] = useState('');
  useEffect(() => {
    const timer = setInterval(() => {
      setDots((current) => (current.length >= 3 ? '' : `${current}.`));
    }, 380);
    return () => clearInterval(timer);
  }, []);
  return <span aria-hidden>{dots}</span>;
}

export function AgentGrid({ agents }: { agents: Record<AgentId, AgentRun> }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
      <AnimatePresence initial={false}>
        {WORKER_AGENT_IDS.map((id) => (
          <AgentCard key={id} run={agents[id]} />
        ))}
      </AnimatePresence>
    </div>
  );
}
