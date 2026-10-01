import type { ArchEdge, ArchitectureMap, ArchNode, ArchNodeKind, Finding, Severity } from '@/types';
import { SEVERITY_ORDER } from '@/lib/constants';
import type { ModuleGraph } from './graph';
import type { RepoIndex } from './repo-index';

/**
 * Architecture map.
 *
 * Derived, not declared: files are bucketed into components by path convention,
 * the module graph is collapsed onto those buckets, and external services are
 * inferred from the SDKs the code actually imports. Risk is projected onto the
 * components that own the files findings landed in.
 */

interface ComponentSpec {
  id: string;
  label: string;
  kind: ArchNodeKind;
  /** Files matching this land in the component. First match wins. */
  match: RegExp;
  description: string;
  /** Layout row, 0 at the top. */
  row: number;
}

const COMPONENTS: ComponentSpec[] = [
  {
    id: 'client',
    label: 'Client',
    kind: 'client',
    match: /(^|\/)(components?|ui|views?|screens?|pages|templates|public|styles)(\/|$)/i,
    description: 'Rendering, user interaction and client-side state.',
    row: 0,
  },
  {
    id: 'edge',
    label: 'API layer',
    kind: 'edge',
    match: /(^|\/)(api|routes?|controllers?|handlers?|endpoints?|resolvers?|graphql)(\/|$)|\/route\.(ts|js)$/i,
    description: 'HTTP entry points: request parsing, response shaping.',
    row: 1,
  },
  {
    id: 'auth',
    label: 'Auth',
    kind: 'service',
    match: /(^|\/)(auth|authentication|authorization|identity|session|middleware|guards?|permissions?)(\/|$)/i,
    description: 'Identity, sessions and access control.',
    row: 2,
  },
  {
    id: 'domain',
    label: 'Domain services',
    kind: 'service',
    match: /(^|\/)(services?|domain|core|business|usecases?|features?|modules?|lib|logic)(\/|$)/i,
    description: 'Business rules, independent of transport.',
    row: 2,
  },
  {
    id: 'workers',
    label: 'Background work',
    kind: 'worker',
    match: /(^|\/)(workers?|jobs?|tasks?|queues?|cron|schedulers?|consumers?)(\/|$)/i,
    description: 'Work that happens outside a request.',
    row: 2,
  },
  {
    id: 'data',
    label: 'Data access',
    kind: 'datastore',
    match: /(^|\/)(db|database|prisma|models?|entities|schemas?|repositor\w*|migrations?|drizzle|dao|store)(\/|$)/i,
    description: 'Persistence, schema and queries.',
    row: 3,
  },
  {
    id: 'infra',
    label: 'Infrastructure',
    kind: 'infra',
    match: /(^|\/)(infra|deploy|terraform|k8s|kubernetes|helm|\.github|docker)(\/|$)|^(Dockerfile|docker-compose)/i,
    description: 'Build, deployment and environment definition.',
    row: 4,
  },
];

/** External services inferred from imports rather than guessed. */
const EXTERNAL_SDKS: { id: string; label: string; pattern: RegExp }[] = [
  { id: 'ext-stripe', label: 'Stripe', pattern: /['"]stripe['"]|stripe\.(com|js)/i },
  { id: 'ext-aws', label: 'AWS', pattern: /@aws-sdk|['"]aws-sdk['"]|boto3/i },
  { id: 'ext-postgres', label: 'PostgreSQL', pattern: /['"]pg['"]|postgres(?:ql)?:\/\/|psycopg/i },
  { id: 'ext-mysql', label: 'MySQL', pattern: /['"]mysql2?['"]|mysql:\/\// },
  { id: 'ext-mongo', label: 'MongoDB', pattern: /mongoose|mongodb(\+srv)?:\/\// },
  { id: 'ext-redis', label: 'Redis', pattern: /['"]ioredis['"]|['"]redis['"]|redis:\/\// },
  { id: 'ext-mail', label: 'Email provider', pattern: /@sendgrid|['"]resend['"]|['"]nodemailer['"]|postmark/i },
  { id: 'ext-s3', label: 'Object storage', pattern: /s3\.|S3Client|cloudinary|['"]@vercel\/blob['"]/i },
  { id: 'ext-auth', label: 'Identity provider', pattern: /next-auth|@auth\/|clerk|auth0|@supabase\/auth/i },
  { id: 'ext-ai', label: 'AI provider', pattern: /['"]openai['"]|@anthropic-ai|generativelanguage/i },
  { id: 'ext-queue', label: 'Message broker', pattern: /['"]bullmq['"]|amqplib|kafkajs|@aws-sdk\/client-sqs/i },
];

function componentFor(path: string): ComponentSpec | null {
  for (const spec of COMPONENTS) {
    if (spec.match.test(path)) return spec;
  }
  return null;
}

function worst(a: Severity | null, b: Severity | null): Severity | null {
  if (!a) return b;
  if (!b) return a;
  return SEVERITY_ORDER[a] <= SEVERITY_ORDER[b] ? a : b;
}

export function buildArchitectureMap(
  index: RepoIndex,
  graph: ModuleGraph,
  findings: Finding[],
): ArchitectureMap {
  const membership = new Map<string, string>();
  const files = new Map<string, string[]>();

  for (const file of index.files) {
    if (file.isVendor || file.isGenerated || file.isDoc) continue;
    const spec = componentFor(file.path);
    if (!spec) continue;
    membership.set(file.path, spec.id);
    const bucket = files.get(spec.id) ?? [];
    if (bucket.length < 40) bucket.push(file.path);
    files.set(spec.id, bucket);
  }

  const present = COMPONENTS.filter((spec) => (files.get(spec.id)?.length ?? 0) > 0);

  /* --- Risk projection --------------------------------------------- */
  const risk = new Map<string, Severity | null>();
  const componentFindings = new Map<string, string[]>();
  for (const finding of findings) {
    if (finding.validation === 'dismissed') continue;
    const componentId = membership.get(finding.location.path);
    if (!componentId) continue;
    risk.set(componentId, worst(risk.get(componentId) ?? null, finding.severity));
    const bucket = componentFindings.get(componentId) ?? [];
    bucket.push(finding.id);
    componentFindings.set(componentId, bucket);
  }

  /* --- Internal edges ----------------------------------------------- */
  const edgeWeights = new Map<string, number>();
  for (const node of graph.nodes.values()) {
    const from = membership.get(node.path);
    if (!from) continue;
    for (const ref of node.imports) {
      if (!ref.resolved) continue;
      const to = membership.get(ref.resolved);
      if (!to || to === from) continue;
      const key = `${from}->${to}`;
      edgeWeights.set(key, (edgeWeights.get(key) ?? 0) + 1);
    }
  }

  /* --- External services -------------------------------------------- */
  const externals: ArchNode[] = [];
  const externalEdges: ArchEdge[] = [];
  for (const sdk of EXTERNAL_SDKS) {
    const matches = index.search(sdk.pattern, { maxMatches: 8, maxPerFile: 1, skipTests: true });
    if (matches.length === 0) continue;

    const callers = new Set<string>();
    for (const match of matches) {
      const componentId = membership.get(match.file.path);
      if (componentId) callers.add(componentId);
    }
    if (callers.size === 0) continue;

    externals.push({
      id: sdk.id,
      label: sdk.label,
      kind: 'external',
      files: matches.slice(0, 5).map((m) => m.file.path),
      findingIds: [],
      risk: null,
      x: 0,
      y: 0,
      description: `Referenced from ${matches.length} ${matches.length === 1 ? 'site' : 'sites'}.`,
    });
    for (const caller of callers) {
      externalEdges.push({ from: caller, to: sdk.id, label: 'calls' });
    }
  }

  /* --- Layout -------------------------------------------------------- */
  // Abstract 0..100 space; the renderer scales and pans it.
  const rows = new Map<number, ComponentSpec[]>();
  for (const spec of present) {
    const bucket = rows.get(spec.row) ?? [];
    bucket.push(spec);
    rows.set(spec.row, bucket);
  }

  const internalNodes: ArchNode[] = [];
  const rowKeys = [...rows.keys()].sort((a, b) => a - b);
  const rowCount = Math.max(1, rowKeys.length);

  rowKeys.forEach((rowKey, rowIndex) => {
    const specs = rows.get(rowKey)!;
    specs.forEach((spec, columnIndex) => {
      const columns = specs.length;
      // Reserve the right-hand band for external services when there are any,
      // and centre each row within what is left.
      const band = externals.length > 0 ? 70 : 92;
      internalNodes.push({
        id: spec.id,
        label: spec.label,
        kind: spec.kind,
        files: files.get(spec.id) ?? [],
        findingIds: componentFindings.get(spec.id) ?? [],
        risk: risk.get(spec.id) ?? null,
        x: 4 + ((columnIndex + 0.5) / columns) * band,
        y: ((rowIndex + 0.5) / rowCount) * 88 + 6,
        description: spec.description,
      });
    });
  });

  externals.forEach((node, i) => {
    node.x = 88;
    node.y = ((i + 0.5) / Math.max(1, externals.length)) * 84 + 8;
  });

  const edges: ArchEdge[] = [
    ...[...edgeWeights.entries()].map(([key, weight]) => {
      const [from, to] = key.split('->') as [string, string];
      const fromRisk = risk.get(from) ?? null;
      const toRisk = risk.get(to) ?? null;
      return {
        from,
        to,
        label: `${weight} ${weight === 1 ? 'import' : 'imports'}`,
        risk: worst(fromRisk, toRisk),
      };
    }),
    ...externalEdges,
  ];

  /* --- Cycles -------------------------------------------------------- */
  // Mapping a cycle onto components collapses an intra-component cycle to
  // "domain → domain", which tells the reader nothing. Keep file names in
  // that case and only abstract to components when the cycle actually
  // crosses a boundary.
  const cycles = graph.cycles.slice(0, 6).map((cycle) => {
    const components = cycle.map((path) => membership.get(path) ?? path);
    const crossesBoundary = new Set(components).size > 1;
    return crossesBoundary
      ? components
      : cycle.map((path) => path.slice(path.lastIndexOf('/') + 1));
  });

  return {
    nodes: [...internalNodes, ...externals],
    edges: edges.filter((edge) => edge.from !== edge.to),
    cycles,
  };
}
