import type {
  DependencyAdvisory,
  DependencyNode,
  DependencyReport,
  RawFinding,
  Severity,
} from '@/types';
import type { RepoIndex } from '@/lib/analysis/repo-index';
import { createLogger } from '@/lib/logger';
import { BUNDLED_ADVISORIES, LICENSE_RISK } from './advisories';

const logger = createLogger('deps');

/* ------------------------------------------------------------------ */
/* Version handling                                                    */
/* ------------------------------------------------------------------ */

/** Strips range operators to the concrete version a lockfile would resolve near. */
export function cleanVersion(raw: string): string {
  return raw
    .trim()
    .replace(/^[\^~>=<v\s]+/, '')
    .replace(/\s.*$/, '')
    .replace(/[,)\]].*$/, '');
}

export function parseSemver(version: string): [number, number, number] | null {
  const match = /^(\d+)\.(\d+)(?:\.(\d+))?/.exec(cleanVersion(version));
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3] ?? 0)];
}

/** -1 / 0 / 1, with `null` when either side is not comparable. */
export function compareVersions(a: string, b: string): number | null {
  const left = parseSemver(a);
  const right = parseSemver(b);
  if (!left || !right) return null;
  for (let i = 0; i < 3; i += 1) {
    if (left[i]! !== right[i]!) return left[i]! < right[i]! ? -1 : 1;
  }
  return 0;
}

export function isVulnerable(version: string, fixedIn: string, introducedIn?: string): boolean {
  const belowFix = compareVersions(version, fixedIn);
  if (belowFix === null || belowFix >= 0) return false;
  if (introducedIn) {
    const aboveIntro = compareVersions(version, introducedIn);
    if (aboveIntro === null || aboveIntro < 0) return false;
  }
  return true;
}

/* ------------------------------------------------------------------ */
/* Manifest parsing                                                    */
/* ------------------------------------------------------------------ */

interface ParsedDependency {
  name: string;
  version: string;
  ecosystem: DependencyNode['ecosystem'];
  direct: boolean;
  dev: boolean;
  manifest: string;
}

function parsePackageJson(content: string, manifest: string): ParsedDependency[] {
  try {
    const json = JSON.parse(content) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    };
    const out: ParsedDependency[] = [];
    const add = (record: Record<string, string> | undefined, dev: boolean) => {
      for (const [name, version] of Object.entries(record ?? {})) {
        out.push({ name, version: cleanVersion(version) || version, ecosystem: 'npm', direct: true, dev, manifest });
      }
    };
    add(json.dependencies, false);
    add(json.devDependencies, true);
    add(json.peerDependencies, false);
    return out;
  } catch {
    return [];
  }
}

function parseRequirementsTxt(content: string, manifest: string): ParsedDependency[] {
  const out: ParsedDependency[] = [];
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('-')) continue;
    const match = /^([A-Za-z0-9._-]+)\s*(?:\[[^\]]*\])?\s*(?:[=<>~!]{1,2}\s*([0-9][\w.*-]*))?/.exec(trimmed);
    if (!match?.[1]) continue;
    out.push({
      name: match[1].toLowerCase(),
      version: match[2] ?? 'unpinned',
      ecosystem: 'pypi',
      direct: true,
      dev: /dev|test/i.test(manifest),
      manifest,
    });
  }
  return out;
}

function parseGoMod(content: string, manifest: string): ParsedDependency[] {
  const out: ParsedDependency[] = [];
  let inBlock = false;
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (/^require\s*\($/.test(trimmed)) {
      inBlock = true;
      continue;
    }
    if (inBlock && trimmed === ')') {
      inBlock = false;
      continue;
    }
    const match = inBlock
      ? /^([\w./-]+)\s+v([\w.+-]+)/.exec(trimmed)
      : /^require\s+([\w./-]+)\s+v([\w.+-]+)/.exec(trimmed);
    if (match?.[1] && match[2]) {
      out.push({
        name: match[1],
        version: match[2],
        ecosystem: 'go',
        direct: !trimmed.includes('// indirect'),
        dev: false,
        manifest,
      });
    }
  }
  return out;
}

function parseTomlDeps(
  content: string,
  manifest: string,
  ecosystem: DependencyNode['ecosystem'],
): ParsedDependency[] {
  const out: ParsedDependency[] = [];
  let section = '';
  for (const raw of content.split('\n')) {
    const line = raw.trim();
    const header = /^\[([^\]]+)\]$/.exec(line);
    if (header) {
      section = header[1]!;
      continue;
    }
    if (!/dependencies/i.test(section)) continue;
    const match = /^([A-Za-z0-9._-]+)\s*=\s*(?:"([^"]+)"|\{[^}]*version\s*=\s*"([^"]+)")/.exec(line);
    if (match?.[1]) {
      out.push({
        name: match[1].toLowerCase(),
        version: cleanVersion(match[2] ?? match[3] ?? ''),
        ecosystem,
        direct: true,
        dev: /dev/i.test(section),
        manifest,
      });
    }
  }
  return out;
}

export function parseManifests(index: RepoIndex): ParsedDependency[] {
  const out: ParsedDependency[] = [];
  for (const manifest of index.manifests) {
    const { file } = manifest;
    const base = file.base.toLowerCase();
    if (base === 'package.json') out.push(...parsePackageJson(file.content, file.path));
    else if (base === 'requirements.txt') out.push(...parseRequirementsTxt(file.content, file.path));
    else if (base === 'go.mod') out.push(...parseGoMod(file.content, file.path));
    else if (base === 'pyproject.toml') out.push(...parseTomlDeps(file.content, file.path, 'pypi'));
    else if (base === 'cargo.toml') out.push(...parseTomlDeps(file.content, file.path, 'cargo'));
  }

  // Deduplicate by ecosystem+name, preferring the runtime declaration.
  const seen = new Map<string, ParsedDependency>();
  for (const dep of out) {
    const key = `${dep.ecosystem}:${dep.name}`;
    const existing = seen.get(key);
    if (!existing || (existing.dev && !dep.dev)) seen.set(key, dep);
  }
  return [...seen.values()];
}

/* ------------------------------------------------------------------ */
/* OSV.dev                                                             */
/* ------------------------------------------------------------------ */

const OSV_ECOSYSTEM: Partial<Record<DependencyNode['ecosystem'], string>> = {
  npm: 'npm',
  pypi: 'PyPI',
  go: 'Go',
  cargo: 'crates.io',
  maven: 'Maven',
  rubygems: 'RubyGems',
};

interface OsvVuln {
  id: string;
  summary?: string;
  details?: string;
  aliases?: string[];
  database_specific?: { severity?: string };
  severity?: { type: string; score: string }[];
  affected?: { ranges?: { events?: { fixed?: string }[] }[] }[];
}

function osvSeverity(vuln: OsvVuln): Severity {
  const label = vuln.database_specific?.severity?.toUpperCase();
  if (label === 'CRITICAL') return 'critical';
  if (label === 'HIGH') return 'high';
  if (label === 'MODERATE' || label === 'MEDIUM') return 'medium';
  if (label === 'LOW') return 'low';

  const cvss = vuln.severity?.find((s) => s.type.startsWith('CVSS'))?.score;
  if (cvss) {
    const score = /\/(?:.*)$/.test(cvss) ? null : Number(cvss);
    if (score !== null && Number.isFinite(score)) {
      if (score >= 9) return 'critical';
      if (score >= 7) return 'high';
      if (score >= 4) return 'medium';
      return 'low';
    }
  }
  return 'medium';
}

async function queryOsv(
  deps: ParsedDependency[],
  timeoutMs = 12_000,
): Promise<Map<string, DependencyAdvisory[]> | null> {
  const queryable = deps
    .filter((d) => OSV_ECOSYSTEM[d.ecosystem] && parseSemver(d.version))
    .slice(0, 400);
  const queries = queryable.map((d) => ({
    package: { name: d.name, ecosystem: OSV_ECOSYSTEM[d.ecosystem]! },
    version: cleanVersion(d.version),
  }));
  if (queries.length === 0) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch('https://api.osv.dev/v1/querybatch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ queries }),
      signal: controller.signal,
    });
    if (!response.ok) return null;

    const body = (await response.json()) as { results?: { vulns?: { id: string }[] }[] };
    const results = body.results ?? [];

    // Collect the distinct advisory ids, then fetch details for a bounded set.
    const idsByKey = new Map<string, string[]>();
    const allIds = new Set<string>();
    results.forEach((result, i) => {
      const dep = queryable[i];
      if (!dep || !result.vulns?.length) return;
      const ids = result.vulns.map((v) => v.id).slice(0, 5);
      idsByKey.set(`${dep.ecosystem}:${dep.name}`, ids);
      for (const id of ids) allIds.add(id);
    });
    if (allIds.size === 0) return new Map();

    const details = new Map<string, OsvVuln>();
    const idList = [...allIds].slice(0, 40);
    await Promise.all(
      idList.map(async (id) => {
        try {
          const res = await fetch(`https://api.osv.dev/v1/vulns/${encodeURIComponent(id)}`, {
            signal: controller.signal,
          });
          if (res.ok) details.set(id, (await res.json()) as OsvVuln);
        } catch {
          // Individual failures are fine; the advisory simply carries less detail.
        }
      }),
    );

    const out = new Map<string, DependencyAdvisory[]>();
    for (const [key, ids] of idsByKey) {
      out.set(
        key,
        ids.map((id) => {
          const vuln = details.get(id);
          const fixed = vuln?.affected?.[0]?.ranges?.[0]?.events?.find((e) => e.fixed)?.fixed;
          return {
            id,
            severity: vuln ? osvSeverity(vuln) : 'medium',
            title: vuln?.summary ?? vuln?.details?.slice(0, 120) ?? 'Known vulnerability',
            ...(fixed ? { fixedIn: fixed } : {}),
            url: `https://osv.dev/vulnerability/${id}`,
          };
        }),
      );
    }
    return out;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------ */
/* Registry metadata (latest version)                                  */
/* ------------------------------------------------------------------ */

interface RegistryMeta {
  version: string;
  license?: string;
}

async function fetchNpmMetadata(
  names: string[],
  timeoutMs = 10_000,
): Promise<Map<string, RegistryMeta>> {
  const out = new Map<string, RegistryMeta>();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    await Promise.all(
      names.slice(0, 40).map(async (name) => {
        try {
          const res = await fetch(
            `https://registry.npmjs.org/${encodeURIComponent(name).replace('%40', '@')}/latest`,
            { signal: controller.signal, headers: { accept: 'application/json' } },
          );
          if (!res.ok) return;
          const body = (await res.json()) as { version?: string; license?: string };
          if (body.version) {
            out.set(name, {
              version: body.version,
              ...(typeof body.license === 'string' ? { license: body.license } : {}),
            });
          }
        } catch {
          // Best effort only.
        }
      }),
    );
  } finally {
    clearTimeout(timer);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Analysis                                                            */
/* ------------------------------------------------------------------ */

function usageOf(index: RepoIndex, name: string): string[] {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const matches = index.search(
    new RegExp(`(?:from\\s+['"]${escaped}(?:/[^'"]*)?['"]|require\\(\\s*['"]${escaped}|^\\s*import\\s+${escaped}\\b)`),
    { maxMatches: 6, maxPerFile: 1, skipTests: false },
  );
  return [...new Set(matches.map((m) => m.file.path))];
}

export interface DependencyAnalysis {
  report: DependencyReport;
  findings: RawFinding[];
}

export async function analyzeDependencies(
  index: RepoIndex,
  options: { allowNetwork: boolean } = { allowNetwork: true },
): Promise<DependencyAnalysis> {
  const parsed = parseManifests(index);
  const manifests = index.manifests.map((m) => m.path);

  let advisoryMap: Map<string, DependencyAdvisory[]> | null = null;
  if (options.allowNetwork && parsed.length > 0) {
    advisoryMap = await queryOsv(parsed);
    if (advisoryMap) logger.info('osv.ok', { packages: parsed.length });
  }
  const live = advisoryMap !== null;

  const npmNames = parsed.filter((d) => d.ecosystem === 'npm' && !d.dev).map((d) => d.name);
  const registryMap =
    options.allowNetwork && npmNames.length > 0
      ? await fetchNpmMetadata(npmNames)
      : new Map<string, RegistryMeta>();

  const nodes: DependencyNode[] = [];
  const findings: RawFinding[] = [];

  for (const dep of parsed) {
    const key = `${dep.ecosystem}:${dep.name}`;
    const advisories: DependencyAdvisory[] = live
      ? (advisoryMap!.get(key) ?? [])
      : BUNDLED_ADVISORIES.filter(
          (a) =>
            a.ecosystem === dep.ecosystem &&
            a.package === dep.name.toLowerCase() &&
            isVulnerable(dep.version, a.fixedIn, a.introducedIn),
        ).map((a) => ({
          id: a.cve ?? a.id,
          severity: a.severity,
          title: a.title,
          fixedIn: a.fixedIn,
          url: a.url,
        }));

    const registry = registryMap.get(dep.name);
    const latest = registry?.version;
    const current = parseSemver(dep.version);
    const newest = latest ? parseSemver(latest) : null;
    const majorsBehind = current && newest ? Math.max(0, newest[0] - current[0]) : undefined;

    const worst = advisories.reduce<Severity | null>((acc, a) => {
      const order: Severity[] = ['critical', 'high', 'medium', 'low', 'info'];
      if (!acc) return a.severity;
      return order.indexOf(a.severity) < order.indexOf(acc) ? a.severity : acc;
    }, null);

    const usedIn = usageOf(index, dep.name);

    nodes.push({
      name: dep.name,
      ecosystem: dep.ecosystem,
      version: dep.version,
      ...(latest ? { latest } : {}),
      direct: dep.direct,
      dev: dep.dev,
      ...(registry?.license ? { license: registry.license } : {}),
      maintenance: majorsBehind !== undefined && majorsBehind >= 2 ? 'slowing' : 'unknown',
      advisories,
      risk: worst ?? (majorsBehind && majorsBehind >= 2 ? 'low' : null),
      usedIn,
      ...(majorsBehind !== undefined ? { majorsBehind } : {}),
    });

    for (const advisory of advisories) {
      findings.push({
        ruleId: 'dep.known-vulnerability',
        title: `${dep.name}@${dep.version} — ${advisory.title}`,
        category: 'dependencies',
        severity: dep.dev && advisory.severity === 'critical' ? 'high' : advisory.severity,
        confidence: 0.95,
        detectedBy: 'dependencies',
        detectors: [live ? 'osv' : 'bundled-advisories'],
        location: { path: dep.manifest, language: 'JSON' },
        summary: `\`${dep.name}\` is pinned at ${dep.version}, which is affected by ${advisory.id}: ${advisory.title}.`,
        impact: dep.dev
          ? 'This is a development dependency, so it does not ship to production — but it runs on developer machines and in CI, which usually hold credentials.'
          : `The vulnerable code ships with the application. ${usedIn.length > 0 ? `It is imported in ${usedIn.length} ${usedIn.length === 1 ? 'file' : 'files'}.` : 'Sentinel found no direct import, so it may only be reachable transitively.'}`,
        evidence: [
          {
            kind: 'dependency',
            label: 'Advisory',
            detail: `${advisory.id} — ${advisory.title}${advisory.fixedIn ? ` (fixed in ${advisory.fixedIn})` : ''}`,
            source: live ? 'osv.dev' : 'bundled advisory snapshot',
          },
          {
            kind: 'config',
            label: 'Declared version',
            detail: `${dep.name}: ${dep.version}`,
            path: dep.manifest,
          },
          ...(usedIn.length
            ? [
                {
                  kind: 'code' as const,
                  label: 'Import sites',
                  detail: usedIn.slice(0, 4).join(', '),
                  path: usedIn[0]!,
                },
              ]
            : []),
        ],
        recommendation: advisory.fixedIn
          ? `Upgrade \`${dep.name}\` to ${advisory.fixedIn} or later. Check the changelog for breaking changes between ${dep.version} and ${advisory.fixedIn} before merging.`
          : `Upgrade \`${dep.name}\` to the latest release and re-run the audit.`,
        rootCauseId: 'vulnerable-dependencies',
        cwe: 'CWE-1395',
        owasp: 'A06:2021 Vulnerable and Outdated Components',
        references: advisory.url ? [{ label: advisory.id, url: advisory.url }] : [],
        effortMinutes: 20,
        ...(advisory.fixedIn && dep.manifest.endsWith('package.json')
          ? {
              patch: {
                path: dep.manifest,
                language: 'json',
                requiresReview: false,
                description: `Bump ${dep.name} to a fixed release.`,
                diff: [
                  `--- a/${dep.manifest}`,
                  `+++ b/${dep.manifest}`,
                  '@@',
                  `-    "${dep.name}": "${dep.version}",`,
                  `+    "${dep.name}": "^${advisory.fixedIn}",`,
                ].join('\n'),
              },
            }
          : {}),
      });
    }

    if (dep.version === 'unpinned' || dep.version === '*' || dep.version === 'latest') {
      findings.push({
        ruleId: 'dep.unpinned-version',
        title: `${dep.name} has no version constraint`,
        category: 'dependencies',
        severity: 'medium',
        confidence: 0.9,
        detectedBy: 'dependencies',
        detectors: ['manifest-parser'],
        location: { path: dep.manifest, language: 'JSON' },
        summary: `\`${dep.name}\` is declared without a version constraint in \`${dep.manifest}\`.`,
        impact:
          'Two installs of the same commit can resolve to different code. That makes builds unreproducible and lets a compromised release reach production without any change on your side.',
        evidence: [
          {
            kind: 'config',
            label: 'Declaration',
            detail: `${dep.name}: ${dep.version}`,
            path: dep.manifest,
          },
        ],
        recommendation:
          'Pin to a range you have tested (`^1.2.3`) and commit the lockfile so CI installs exactly what you reviewed.',
        rootCauseId: 'unreproducible-builds',
        references: [],
        effortMinutes: 10,
      });
    }
  }

  // A missing lockfile is a repository-level finding, not a per-package one.
  const hasNpmManifest = manifests.some((m) => m.endsWith('package.json'));
  const hasLock = index.files.some((f) =>
    /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb)$/.test(f.path),
  );
  if (hasNpmManifest && !hasLock) {
    findings.push({
      ruleId: 'dep.missing-lockfile',
      title: 'No lockfile committed',
      category: 'dependencies',
      severity: 'medium',
      confidence: 0.93,
      detectedBy: 'dependencies',
      detectors: ['manifest-parser'],
      location: { path: manifests.find((m) => m.endsWith('package.json')) ?? 'package.json' },
      summary:
        'The project declares npm dependencies but no lockfile is committed, so the exact dependency tree is decided at install time.',
      impact:
        'Builds are not reproducible, CI and local machines can diverge, and a malicious patch release is installed automatically.',
      evidence: [
        {
          kind: 'absence',
          label: 'Lockfile',
          detail: 'No package-lock.json, yarn.lock, pnpm-lock.yaml or bun.lockb found in the repository.',
        },
      ],
      recommendation: 'Commit the lockfile your package manager generates and use `npm ci` in CI.',
      rootCauseId: 'unreproducible-builds',
      references: [],
      effortMinutes: 10,
    });
  }

  // Licence review, for direct runtime dependencies only.
  for (const node of nodes) {
    if (!node.direct || node.dev || !node.license) continue;
    const risk = LICENSE_RISK[node.license];
    if (!risk) continue;
    findings.push({
      ruleId: 'dep.license-review',
      title: `${node.name} is ${node.license}`,
      category: 'dependencies',
      severity: risk.risk,
      confidence: 0.8,
      detectedBy: 'dependencies',
      detectors: ['manifest-parser'],
      location: { path: manifests[0] ?? 'package.json' },
      summary: `\`${node.name}\` is distributed under ${node.license}. ${risk.note}`,
      impact: 'Licence obligations are a business decision, not a technical one. This is a prompt to check, not legal advice.',
      evidence: [{ kind: 'dependency', label: 'Licence', detail: node.license }],
      recommendation: 'Confirm the obligations fit how you distribute this project, or find an alternative package.',
      rootCauseId: 'license-obligations',
      references: [],
      effortMinutes: 30,
    });
  }

  const report: DependencyReport = {
    manifests,
    nodes: nodes.sort((a, b) => {
      const order: (Severity | null)[] = ['critical', 'high', 'medium', 'low', 'info', null];
      const diff = order.indexOf(a.risk) - order.indexOf(b.risk);
      return diff !== 0 ? diff : a.name.localeCompare(b.name);
    }),
    directCount: nodes.filter((n) => n.direct).length,
    vulnerableCount: nodes.filter((n) => n.advisories.length > 0).length,
    outdatedCount: nodes.filter((n) => (n.majorsBehind ?? 0) > 0).length,
    live,
    advisorySource: live
      ? 'OSV.dev (live)'
      : 'Bundled advisory snapshot — enable outbound network access for full OSV coverage',
  };

  return { report, findings };
}
