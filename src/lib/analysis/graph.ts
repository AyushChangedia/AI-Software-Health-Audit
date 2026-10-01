import type { RepoIndex, RepoFile } from './repo-index';

/**
 * Module graph.
 *
 * Deliberately not a full parser: we extract import statements with regexes and
 * resolve relative specifiers against the file list. That is enough to find
 * cycles, dangling imports and layering violations with high confidence, and it
 * works on any repository without a build step or a language toolchain.
 */

export interface ImportRef {
  /** Raw specifier as written. */
  specifier: string;
  line: number;
  /** Named symbols pulled in, when the form makes them visible. */
  symbols: string[];
  /** Resolved repository path, or null for external packages / unresolved. */
  resolved: string | null;
  external: boolean;
}

export interface ModuleNode {
  path: string;
  imports: ImportRef[];
  importedBy: string[];
  exports: string[];
}

export interface ModuleGraph {
  nodes: Map<string, ModuleNode>;
  /** Strongly connected components with more than one member. */
  cycles: string[][];
  /** Relative imports that do not resolve to any file in the repository. */
  dangling: { from: string; specifier: string; line: number }[];
  /** Exported symbols never imported anywhere else. */
  unusedExports: { path: string; symbol: string; line: number }[];
}

const JS_IMPORT_RE =
  /^\s*import\s+(?:type\s+)?(?:([\w*\s{},$]+?)\s+from\s+)?['"]([^'"]+)['"]|^\s*(?:const|let|var)\s+([\w{},:\s$]+)\s*=\s*require\s*\(\s*['"]([^'"]+)['"]\s*\)|^\s*export\s+(?:\*|\{[^}]*\})\s+from\s+['"]([^'"]+)['"]/;
const PY_IMPORT_RE = /^\s*(?:from\s+([\w.]+)\s+import\s+([\w*,\s()]+)|import\s+([\w.]+))/;
const JS_EXPORT_RE =
  /^\s*export\s+(?:default\s+)?(?:async\s+)?(?:(?:const|let|var|function|class|interface|type|enum)\s+(\w+)|\{\s*([^}]+)\s*\})/;
const PY_EXPORT_RE = /^\s*(?:def|class)\s+(\w+)/;

const JS_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts', '.vue', '.svelte'];

function parseSymbols(clause: string | undefined): string[] {
  if (!clause) return [];
  const braced = /\{([^}]*)\}/.exec(clause);
  const body = braced?.[1] ?? clause;
  return body
    .split(',')
    .map((part) => part.trim().split(/\s+as\s+/)[0]?.trim() ?? '')
    .map((s) => s.replace(/^\*\s*/, '').replace(/^type\s+/, ''))
    .filter((s) => s && /^[\w$]+$/.test(s));
}

function dirname(path: string): string {
  const i = path.lastIndexOf('/');
  return i === -1 ? '' : path.slice(0, i);
}

function normalize(path: string): string {
  const out: string[] = [];
  for (const segment of path.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') out.pop();
    else out.push(segment);
  }
  return out.join('/');
}

/** Resolves a relative specifier the way a bundler would, against the file list. */
function resolveRelative(index: RepoIndex, from: string, specifier: string): string | null {
  const base = normalize(`${dirname(from)}/${specifier}`);
  if (index.has(base)) return base;
  for (const ext of JS_EXTENSIONS) {
    if (index.has(base + ext)) return base + ext;
  }
  for (const ext of JS_EXTENSIONS) {
    if (index.has(`${base}/index${ext}`)) return `${base}/index${ext}`;
  }
  if (index.has(`${base}.py`)) return `${base}.py`;
  if (index.has(`${base}/__init__.py`)) return `${base}/__init__.py`;
  return null;
}

/** Resolves a `@/`-style alias against common source roots. */
function resolveAlias(index: RepoIndex, specifier: string): string | null {
  const bare = specifier.replace(/^[@~]\//, '');
  for (const root of ['src/', 'app/', 'lib/', '']) {
    const base = `${root}${bare}`;
    if (index.has(base)) return base;
    for (const ext of JS_EXTENSIONS) {
      if (index.has(base + ext)) return base + ext;
      if (index.has(`${base}/index${ext}`)) return `${base}/index${ext}`;
    }
  }
  return null;
}

function extractImports(index: RepoIndex, file: RepoFile): ImportRef[] {
  const out: ImportRef[] = [];
  const isPython = file.language === 'Python';
  const limit = Math.min(file.lines.length, 400); // imports live at the top

  for (let i = 0; i < limit; i += 1) {
    const line = file.lines[i]!;
    if (line.length > 400) continue;

    if (isPython) {
      const match = PY_IMPORT_RE.exec(line);
      if (!match) continue;
      const moduleName = match[1] ?? match[3] ?? '';
      if (!moduleName) continue;
      const relative = moduleName.startsWith('.');
      const specifier = relative
        ? `${moduleName.replace(/^\./, './').replace(/\./g, '/')}`
        : moduleName;
      const resolved = relative ? resolveRelative(index, file.path, specifier) : null;
      out.push({
        specifier: moduleName,
        line: i + 1,
        symbols: parseSymbols(match[2]),
        resolved,
        external: !relative,
      });
      continue;
    }

    const match = JS_IMPORT_RE.exec(line);
    if (!match) continue;
    const specifier = match[2] ?? match[4] ?? match[5] ?? '';
    if (!specifier) continue;
    const clause = match[1] ?? match[3];
    const relative = specifier.startsWith('.');
    const aliased = /^[@~]\//.test(specifier);
    const resolved = relative
      ? resolveRelative(index, file.path, specifier)
      : aliased
        ? resolveAlias(index, specifier)
        : null;
    out.push({
      specifier,
      line: i + 1,
      symbols: parseSymbols(clause),
      resolved,
      external: !relative && !aliased,
    });
  }
  return out;
}

function extractExports(file: RepoFile): { symbol: string; line: number }[] {
  const out: { symbol: string; line: number }[] = [];
  const isPython = file.language === 'Python';

  for (let i = 0; i < file.lines.length; i += 1) {
    const line = file.lines[i]!;
    if (line.length > 400) continue;
    if (isPython) {
      const match = PY_EXPORT_RE.exec(line);
      if (match?.[1] && !match[1].startsWith('_')) out.push({ symbol: match[1], line: i + 1 });
      continue;
    }
    const match = JS_EXPORT_RE.exec(line);
    if (!match) continue;
    if (match[1]) out.push({ symbol: match[1], line: i + 1 });
    else if (match[2]) {
      for (const symbol of parseSymbols(match[2])) out.push({ symbol, line: i + 1 });
    }
  }
  return out;
}

/** Tarjan's algorithm — returns strongly connected components of size > 1. */
function findCycles(nodes: Map<string, ModuleNode>): string[][] {
  let counter = 0;
  const indexOf = new Map<string, number>();
  const lowLink = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const components: string[][] = [];

  const strongConnect = (v: string) => {
    // Iterative to avoid blowing the stack on large graphs.
    const work: { node: string; childIndex: number }[] = [{ node: v, childIndex: 0 }];
    indexOf.set(v, counter);
    lowLink.set(v, counter);
    counter += 1;
    stack.push(v);
    onStack.add(v);

    while (work.length > 0) {
      const frame = work[work.length - 1]!;
      const node = nodes.get(frame.node);
      const children = (node?.imports ?? [])
        .map((i) => i.resolved)
        .filter((p): p is string => Boolean(p) && nodes.has(p!));

      if (frame.childIndex < children.length) {
        const child = children[frame.childIndex]!;
        frame.childIndex += 1;
        if (!indexOf.has(child)) {
          indexOf.set(child, counter);
          lowLink.set(child, counter);
          counter += 1;
          stack.push(child);
          onStack.add(child);
          work.push({ node: child, childIndex: 0 });
        } else if (onStack.has(child)) {
          lowLink.set(frame.node, Math.min(lowLink.get(frame.node)!, indexOf.get(child)!));
        }
        continue;
      }

      work.pop();
      const parent = work[work.length - 1];
      if (parent) {
        lowLink.set(parent.node, Math.min(lowLink.get(parent.node)!, lowLink.get(frame.node)!));
      }
      if (lowLink.get(frame.node) === indexOf.get(frame.node)) {
        const component: string[] = [];
        for (;;) {
          const w = stack.pop()!;
          onStack.delete(w);
          component.push(w);
          if (w === frame.node) break;
        }
        if (component.length > 1) components.push(component.reverse());
      }
    }
  };

  for (const key of nodes.keys()) {
    if (!indexOf.has(key)) strongConnect(key);
  }
  return components;
}

export function buildModuleGraph(index: RepoIndex): ModuleGraph {
  const nodes = new Map<string, ModuleNode>();
  const exportLines = new Map<string, Map<string, number>>();

  const candidates = index.files.filter(
    (f) => f.isCode && !f.isVendor && !f.isGenerated && f.lines.length < 20_000,
  );

  for (const file of candidates) {
    const exports = extractExports(file);
    const lineMap = new Map<string, number>();
    for (const e of exports) lineMap.set(e.symbol, e.line);
    exportLines.set(file.path, lineMap);
    nodes.set(file.path, {
      path: file.path,
      imports: extractImports(index, file),
      importedBy: [],
      exports: exports.map((e) => e.symbol),
    });
  }

  const dangling: ModuleGraph['dangling'] = [];
  const usedSymbols = new Map<string, Set<string>>();

  for (const node of nodes.values()) {
    for (const ref of node.imports) {
      if (ref.external) continue;
      if (!ref.resolved) {
        // A relative import that points at nothing. Common after a refactor,
        // and one of the clearest signals of a file that was never run.
        if (ref.specifier.startsWith('.') || /^[@~]\//.test(ref.specifier)) {
          dangling.push({ from: node.path, specifier: ref.specifier, line: ref.line });
        }
        continue;
      }
      const target = nodes.get(ref.resolved);
      if (target) target.importedBy.push(node.path);
      const set = usedSymbols.get(ref.resolved) ?? new Set<string>();
      for (const symbol of ref.symbols) set.add(symbol);
      usedSymbols.set(ref.resolved, set);
    }
  }

  const unusedExports: ModuleGraph['unusedExports'] = [];
  for (const node of nodes.values()) {
    // Entry points and framework conventions are imported by the framework,
    // not by other modules, so they can never look "used" here.
    if (isFrameworkEntry(node.path)) continue;
    const used = usedSymbols.get(node.path);
    const lineMap = exportLines.get(node.path);
    for (const symbol of node.exports) {
      if (used?.has(symbol)) continue;
      // A file nobody imports at all is reported once as dead code instead of
      // once per export.
      if (node.importedBy.length === 0 && node.exports.length > 3) break;
      unusedExports.push({ path: node.path, symbol, line: lineMap?.get(symbol) ?? 1 });
    }
  }

  return { nodes, cycles: findCycles(nodes), dangling, unusedExports };
}

/** Paths a framework loads by convention rather than by import. */
export function isFrameworkEntry(path: string): boolean {
  return (
    /(^|\/)(page|layout|route|template|loading|error|not-found|middleware|default|head|index|main|app|server)\.(tsx?|jsx?)$/.test(
      path,
    ) ||
    /(^|\/)(pages|app)\//.test(path) ||
    /(^|\/)__init__\.py$/.test(path) ||
    /(^|\/)(main|manage|wsgi|asgi|settings|urls)\.py$/.test(path) ||
    /\.config\.(ts|js|mjs)$/.test(path) ||
    /(^|\/)(migrations)\//.test(path)
  );
}

/**
 * Layering: a module in `layer` should not reach into `forbidden` directly.
 * These are conventions, not laws, so findings stay at medium confidence.
 */
export const LAYER_RULES: { from: RegExp; to: RegExp; label: string }[] = [
  {
    from: /(^|\/)(components|ui|views|pages)\//,
    to: /(^|\/)(db|database|prisma|models?|repositor\w*|drizzle)(\/|\.)/,
    label: 'presentation code reaching the persistence layer directly',
  },
  {
    from: /(^|\/)(components|ui)\//,
    to: /(^|\/)(api-keys?|secrets?|credentials?)(\/|\.)/,
    label: 'presentation code importing credential handling',
  },
  {
    from: /(^|\/)(domain|core|entities)\//,
    to: /(^|\/)(http|express|fastify|next|react)(\/|\.)/,
    label: 'domain logic depending on a delivery framework',
  },
];

export function findLayerViolations(graph: ModuleGraph) {
  const out: { from: string; to: string; line: number; label: string }[] = [];
  for (const node of graph.nodes.values()) {
    for (const rule of LAYER_RULES) {
      if (!rule.from.test(node.path)) continue;
      for (const ref of node.imports) {
        const target = ref.resolved ?? ref.specifier;
        if (rule.to.test(target)) {
          out.push({ from: node.path, to: target, line: ref.line, label: rule.label });
        }
      }
    }
  }
  return out;
}
