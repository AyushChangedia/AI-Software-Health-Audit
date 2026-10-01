import type { CategoryId } from '@/types';

/**
 * Root causes.
 *
 * A finding names the *rule* that raised it; a root cause names the decision
 * that produced it. The whole point of the improvement plan is that the second
 * list is much shorter than the first, so rules whose fix is genuinely the same
 * piece of work share a cause.
 *
 * Merging here is a judgement about remediation, not about taxonomy: two rules
 * share a cause only when one change closes both. Path traversal and SSRF both
 * reduce to "a value crossed the trust boundary without being constrained", and
 * both are fixed by the same validation boundary — so they merge. Duplication
 * and dead code are both maintainability, and are not the same work — so they
 * do not.
 */

export interface RootCauseTemplate {
  title: string;
  description: string;
  category: CategoryId;
}

/** Rule-level cause → canonical cause. Unlisted ids pass through unchanged. */
const ALIASES: Record<string, string> = {
  'unvalidated-outbound-requests': 'untrusted-input-boundary',
  'unvalidated-filesystem-paths': 'untrusted-input-boundary',
  'unvalidated-redirects': 'untrusted-input-boundary',
  'missing-input-validation': 'untrusted-input-boundary',
  'unsafe-shell-usage': 'data-executed-as-code',
  'unsafe-dynamic-execution': 'data-executed-as-code',
  'weak-transport-security': 'weak-cryptography',
  'missing-null-checks': 'undefined-failure-paths',
  'missing-failure-handling': 'undefined-failure-paths',
  'silent-failure-handling': 'undefined-failure-paths',
  'unbounded-data-access': 'data-access-scales-with-data',
  'n-plus-one-access': 'data-access-scales-with-data',
  'quadratic-algorithms': 'data-access-scales-with-data',
  'no-automated-verification': 'no-test-safety-net',
  'unnecessary-indirection': 'complexity-debt',
  'hardcoded-configuration': 'config-in-source',
  'react-reconciliation': 'client-rendering-cost',
  'bundle-weight': 'client-rendering-cost',
};

export function canonicalRootCause(id: string): string {
  return ALIASES[id] ?? id;
}

export const ROOT_CAUSES: Record<string, RootCauseTemplate> = {
  'secrets-in-source': {
    title: 'Credentials live in the repository',
    description:
      'Secrets are committed rather than injected at runtime. Every one of these values has to be rotated, not just deleted — repository history keeps them.',
    category: 'security',
  },
  'config-in-source': {
    title: 'Environment configuration is baked into the source',
    description:
      'Environment-specific values are written into code, so the same build cannot be promoted between environments and a staging endpoint can reach production unnoticed.',
    category: 'ai-code',
  },
  'unparameterised-queries': {
    title: 'SQL is assembled as text',
    description:
      'Queries are built by interpolation instead of parameter binding. Fixing the pattern once — a query helper that only accepts bound values — closes the whole class rather than each site.',
    category: 'security',
  },
  'data-executed-as-code': {
    title: 'Data is allowed to become code',
    description:
      'Shell strings, dynamic evaluation and unsafe deserialization all turn a data-handling bug into code execution. Each has a safe replacement that covers the real use case.',
    category: 'security',
  },
  'untrusted-input-boundary': {
    title: 'There is no trust boundary at the edge',
    description:
      'Request data flows into queries, file paths, outbound URLs and redirects without being constrained first. One validation boundary per endpoint gives every line after it a known shape and closes several finding classes at once.',
    category: 'security',
  },
  'unescaped-output': {
    title: 'HTML is injected without escaping',
    description:
      'Raw HTML is written into the DOM. Rendering as text by default, with one audited sanitiser for the genuinely rich cases, is the structural fix.',
    category: 'security',
  },
  'auth-trust-boundary': {
    title: 'The authentication trust boundary is not enforced',
    description:
      'Tokens are read without verification, or authorisation is assumed rather than checked. This is the highest-leverage area in the report.',
    category: 'security',
  },
  'weak-cryptography': {
    title: 'Cryptographic primitives do not provide what the code assumes',
    description:
      'Broken hashes, predictable randomness and disabled certificate validation all leave code that looks protected but is not.',
    category: 'security',
  },
  'permissive-configuration': {
    title: 'Defaults were left permissive',
    description:
      'CORS, cookies and debug flags are configured for convenience rather than for production.',
    category: 'security',
  },
  'vulnerable-dependencies': {
    title: 'Dependencies with published advisories',
    description:
      'Packages are pinned below their fixed version. These are the cheapest findings in the report to close — a version bump and a regression run.',
    category: 'dependencies',
  },
  'unreproducible-builds': {
    title: 'Dependency resolution is not reproducible',
    description:
      'Without pinning and a committed lockfile, two installs of the same commit can produce different code.',
    category: 'dependencies',
  },
  'dependency-drift': {
    title: 'The dependency list has drifted from what the code uses',
    description: 'Declared packages are no longer imported, so the real dependency surface is unclear.',
    category: 'dependencies',
  },
  'license-obligations': {
    title: 'Licences that need a decision',
    description:
      'Some dependencies carry obligations worth confirming against how you distribute this project.',
    category: 'dependencies',
  },
  'undefined-failure-paths': {
    title: 'Failure paths have no defined behaviour',
    description:
      'Errors are swallowed, timeouts are missing and empty results are treated as impossible. The system degrades unpredictably, and the damage surfaces far from its cause.',
    category: 'reliability',
  },
  'money-precision': {
    title: 'Money is handled as floating point',
    description:
      'Monetary arithmetic uses binary floating point, so totals drift and reconciliation against the payment provider fails.',
    category: 'reliability',
  },
  'module-coupling': {
    title: 'Modules are entangled',
    description:
      'Import cycles and oversized modules mean changes cannot be made in isolation, and initialisation order is not deterministic.',
    category: 'architecture',
  },
  'layer-leakage': {
    title: 'Layer boundaries are not enforced',
    description:
      'Presentation code reaches the persistence layer directly, so the boundary between them cannot be relied on.',
    category: 'architecture',
  },
  'no-test-safety-net': {
    title: 'No safety net under the paths that matter',
    description:
      'The code handling money, identity and permissions has no automated verification, and nothing enforces the tests that do exist. Regressions there stay invisible until a user finds them.',
    category: 'testing',
  },
  'data-access-scales-with-data': {
    title: 'Data access cost grows with the data',
    description:
      'Queries inside loops, reads with no upper bound and nested linear scans all work at development scale and fail at production scale.',
    category: 'performance',
  },
  'blocking-event-loop': {
    title: 'Blocking work on the request path',
    description: 'Synchronous I/O on a single-threaded runtime stalls every concurrent request.',
    category: 'performance',
  },
  'complex-hot-paths': {
    title: 'Complexity concentrated in hot paths',
    description: 'The most-executed functions are also the hardest to reason about.',
    category: 'performance',
  },
  'client-rendering-cost': {
    title: 'The client ships and re-renders more than it needs',
    description:
      'Whole-library imports and index-based list keys make pages heavier to download and more expensive to update.',
    category: 'performance',
  },
  'complexity-debt': {
    title: 'Functions and files have outgrown their shape',
    description:
      'Complexity, length, parameter counts and pass-through layers have crossed the point where review and testing stop being reliable.',
    category: 'maintainability',
  },
  'duplicated-logic': {
    title: 'The same logic exists in several places',
    description:
      'Fixes applied to one copy leave the others wrong, so the same bug returns somewhere else later.',
    category: 'maintainability',
  },
  'dead-code': {
    title: 'Code nothing uses is still maintained',
    description: 'Unused exports and unreferenced modules are reviewed and refactored for no benefit.',
    category: 'maintainability',
  },
  'incomplete-implementations': {
    title: 'Work that was started and not finished',
    description:
      'Placeholders, unresolved imports and TODO markers mark where the implementation stopped short of the intent.',
    category: 'ai-code',
  },
  'inconsistent-error-contract': {
    title: 'No single error convention',
    description:
      'Some functions throw, others return error values. Callers cannot know which without reading each one.',
    category: 'ai-code',
  },
  'no-logging-strategy': {
    title: 'Logging is ad hoc',
    description:
      'Console calls scattered through the code have no levels, no structure and no redaction.',
    category: 'ai-code',
  },
};

export function rootCauseTemplate(id: string): RootCauseTemplate {
  return (
    ROOT_CAUSES[id] ?? {
      title: id.replace(/-/g, ' ').replace(/^\w/, (c) => c.toUpperCase()),
      description: 'Findings that share an underlying cause.',
      category: 'maintainability',
    }
  );
}
