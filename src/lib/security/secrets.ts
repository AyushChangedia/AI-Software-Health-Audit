import type { RawFinding } from '@/types';
import type { RepoIndex, RepoFile } from '@/lib/analysis/repo-index';

/**
 * Secret detection.
 *
 * Two passes, in the style of Gitleaks:
 *   1. high-signal vendor patterns (an AWS key looks like exactly one thing)
 *   2. a generic "assignment that looks like a credential" pass, gated on
 *      Shannon entropy so that `password = "hunter2"` in a fixture does not
 *      light up the report.
 *
 * Secret values are never stored, logged or rendered in full.
 */

interface SecretRule {
  id: string;
  label: string;
  pattern: RegExp;
  /** Which capture group holds the secret itself. */
  valueGroup: number;
  severity: 'critical' | 'high' | 'medium';
  /** Only these are worth calling "live credential" language. */
  live: boolean;
  guidance: string;
  minEntropy?: number;
}

const RULES: SecretRule[] = [
  {
    id: 'aws-access-key',
    label: 'AWS access key id',
    pattern: /\b(AKIA[0-9A-Z]{16})\b/,
    valueGroup: 1,
    severity: 'critical',
    live: true,
    guidance: 'Deactivate the key in IAM, then issue a replacement through your secret manager.',
  },
  {
    id: 'aws-secret-key',
    label: 'AWS secret access key',
    pattern: /aws.{0,20}?(?:secret|private).{0,20}?['"]([A-Za-z0-9/+=]{40})['"]/i,
    valueGroup: 1,
    severity: 'critical',
    live: true,
    guidance: 'Rotate the credential pair in IAM immediately.',
  },
  {
    id: 'github-pat',
    label: 'GitHub personal access token',
    pattern: /\b(gh[pousr]_[A-Za-z0-9]{36,})\b/,
    valueGroup: 1,
    severity: 'critical',
    live: true,
    guidance: 'Revoke the token under GitHub → Settings → Developer settings.',
  },
  {
    id: 'github-fine-grained',
    label: 'GitHub fine-grained token',
    pattern: /\b(github_pat_[A-Za-z0-9_]{50,})\b/,
    valueGroup: 1,
    severity: 'critical',
    live: true,
    guidance: 'Revoke the token under GitHub → Settings → Developer settings.',
  },
  {
    id: 'stripe-live-key',
    label: 'Stripe live secret key',
    pattern: /\b((?:sk|rk)_live_[A-Za-z0-9]{20,})\b/,
    valueGroup: 1,
    severity: 'critical',
    live: true,
    guidance: 'Roll the key in the Stripe dashboard and audit recent API activity.',
  },
  {
    id: 'slack-token',
    label: 'Slack token',
    pattern: /\b(xox[baprs]-[A-Za-z0-9-]{10,})\b/,
    valueGroup: 1,
    severity: 'high',
    live: true,
    guidance: 'Revoke the token in the Slack app configuration.',
  },
  {
    id: 'google-api-key',
    label: 'Google API key',
    pattern: /\b(AIza[0-9A-Za-z_-]{35})\b/,
    valueGroup: 1,
    severity: 'high',
    live: true,
    guidance: 'Restrict or regenerate the key in the Google Cloud console.',
  },
  {
    id: 'sendgrid-key',
    label: 'SendGrid API key',
    pattern: /\b(SG\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{30,})\b/,
    valueGroup: 1,
    severity: 'high',
    live: true,
    guidance: 'Delete the key in SendGrid and issue a scoped replacement.',
  },
  {
    id: 'npm-token',
    label: 'npm access token',
    pattern: /\b(npm_[A-Za-z0-9]{36})\b/,
    valueGroup: 1,
    severity: 'high',
    live: true,
    guidance: 'Revoke the token with `npm token revoke`.',
  },
  {
    id: 'private-key',
    label: 'Private key block',
    pattern: /(-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----)/,
    valueGroup: 1,
    severity: 'critical',
    live: true,
    guidance: 'Treat the key as compromised: rotate it and re-issue anything signed with it.',
  },
  {
    id: 'connection-string',
    label: 'Database connection string with inline password',
    pattern:
      /\b((?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp):\/\/[^:\s'"]+:[^@\s'"]{4,}@[^\s'"]+)/,
    valueGroup: 1,
    severity: 'critical',
    live: true,
    guidance: 'Move the URL into an environment variable and rotate the database password.',
  },
  {
    id: 'jwt',
    label: 'JSON Web Token',
    pattern: /\b(eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})\b/,
    valueGroup: 1,
    severity: 'medium',
    live: false,
    guidance: 'If this token is not an expired fixture, invalidate the signing key.',
  },
  {
    id: 'generic-credential',
    label: 'Hard-coded credential',
    pattern:
      /(?:api[_-]?key|apikey|secret|token|passwd|password|credential|auth[_-]?key|private[_-]?key)\s*[:=]\s*['"]([^'"\s]{12,})['"]/i,
    valueGroup: 1,
    severity: 'high',
    live: false,
    minEntropy: 3.4,
    guidance: 'Read the value from the environment and rotate whatever it unlocks.',
  },
];

/** Values that are obviously not real credentials. */
const PLACEHOLDER = new RegExp(
  [
    '^\\$\\{',
    'process\\.env',
    'os\\.environ',
    'System\\.getenv',
    '^<',
    'xxx+',
    'your[_-]?',
    'my[_-]?secret',
    'change[_-]?me',
    'replace[_-]?me',
    'example',
    'placeholder',
    'dummy',
    'sample',
    'insert[_-]?',
    'todo',
    'fake',
    '^\\*+$',
    '^\\.\\.\\.',
    '^(test|dev|local)(-|_)?(key|secret|token|password)?$',
  ].join('|'),
  'i',
);

export function shannonEntropy(value: string): number {
  if (!value) return 0;
  const counts = new Map<string, number>();
  for (const char of value) counts.set(char, (counts.get(char) ?? 0) + 1);
  let entropy = 0;
  for (const count of counts.values()) {
    const p = count / value.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

/** `ghp_abcd…wxyz` — enough to recognise, not enough to use. */
export function maskSecret(value: string): string {
  if (value.length <= 8) return '••••••••';
  return `${value.slice(0, 4)}${'•'.repeat(Math.min(12, value.length - 8))}${value.slice(-4)}`;
}

function isExampleFile(file: RepoFile): boolean {
  const lower = file.path.toLowerCase();
  return (
    /\.(example|sample|template|dist)$/.test(lower) ||
    /(^|[./])(example|sample|template)\./.test(file.base.toLowerCase()) ||
    lower.includes('fixtures/') ||
    lower.includes('/examples/')
  );
}

export interface SecretScanResult {
  findings: RawFinding[];
  filesScanned: number;
  /**
   * Every raw value the scanner matched.
   *
   * A snippet rendered for one finding can contain a *neighbouring* secret —
   * the line above it in the same .env file, for instance. The orchestrator
   * applies `createRedactor` over the whole report so no matched value can
   * reach the browser through any finding.
   */
  secrets: string[];
}

/** Masks every known secret value wherever it appears in a string. */
export function createRedactor(secrets: string[]): (text: string) => string {
  // Longest first, so a value containing another is masked as a whole.
  const ordered = [...new Set(secrets)].filter((s) => s.length >= 8).sort((a, b) => b.length - a.length);
  if (ordered.length === 0) return (text) => text;
  return (text: string) => {
    let out = text;
    for (const secret of ordered) {
      if (out.includes(secret)) out = out.split(secret).join(maskSecret(secret));
    }
    return out;
  };
}

export function scanForSecrets(index: RepoIndex): SecretScanResult {
  const findings: RawFinding[] = [];
  const seen = new Set<string>();
  const secrets: string[] = [];
  let filesScanned = 0;

  for (const file of index.files) {
    if (file.isVendor || file.isGenerated) continue;
    if (!file.content) continue;
    filesScanned += 1;

    const example = isExampleFile(file);
    const lockLike = /lock|\.snap$/.test(file.base.toLowerCase());
    if (lockLike) continue;

    for (let i = 0; i < file.lines.length; i += 1) {
      const line = file.lines[i]!;
      if (line.length > 1_000) continue;

      for (const rule of RULES) {
        const match = rule.pattern.exec(line);
        if (!match) continue;
        const value = match[rule.valueGroup] ?? match[0]!;
        if (PLACEHOLDER.test(value)) continue;
        if (rule.minEntropy && shannonEntropy(value) < rule.minEntropy) continue;

        const key = `${rule.id}:${file.path}:${i + 1}`;
        if (seen.has(key)) continue;
        seen.add(key);
        secrets.push(value);

        // An example/template file still matters, but it is not an incident.
        const severity = example ? 'low' : file.isTest ? 'medium' : rule.severity;
        const confidence = example ? 0.45 : rule.live ? 0.93 : 0.7;

        findings.push({
          ruleId: `sec.secret.${rule.id}`,
          title: example
            ? `${rule.label} in a template file`
            : `${rule.label} committed to the repository`,
          category: 'security',
          severity,
          confidence,
          detectedBy: 'security',
          detectors: ['secret-scanner'],
          location: {
            ...index.snippet(file.path, i + 1, 2),
            // Redact the secret before it can reach the browser or a log.
            snippet: redactLineInSnippet(index.snippet(file.path, i + 1, 2).snippet, value),
          },
          summary: example
            ? `${file.path} contains something shaped like a real ${rule.label.toLowerCase()}. Template files should only hold obviously fake values.`
            : `A ${rule.label.toLowerCase()} is committed in \`${file.path}\`. Anyone with read access to this repository — and anyone who ever cloned it — has the value.`,
          impact: example
            ? 'Low direct risk, but real values in templates get copied into real deployments.'
            : 'Repository history is forever. Removing the line in a later commit does not revoke the credential; only rotation does.',
          evidence: [
            {
              kind: 'code',
              label: 'Matched value (masked)',
              detail: `${rule.label}: ${maskSecret(value)}`,
              path: file.path,
              line: i + 1,
              source: 'secret-scanner',
            },
            {
              kind: 'reasoning',
              label: 'Why this is not a false positive',
              detail: rule.minEntropy
                ? `The value has Shannon entropy ${shannonEntropy(value).toFixed(2)} (threshold ${rule.minEntropy}) and does not match any placeholder pattern.`
                : `The value matches the vendor-specific format for a ${rule.label.toLowerCase()}, which has no other legitimate shape.`,
            },
          ],
          recommendation: `${rule.guidance} Then remove the literal from the source, load it from the environment, and consider rewriting history with \`git filter-repo\` if the repository is public.`,
          rootCauseId: 'secrets-in-source',
          cwe: 'CWE-798',
          owasp: 'A07:2021 Identification and Authentication Failures',
          references: [
            { label: 'CWE-798: Use of Hard-coded Credentials', url: 'https://cwe.mitre.org/data/definitions/798.html' },
          ],
          effortMinutes: example ? 10 : 45,
        });
      }
    }
  }

  // A committed `.env` is its own finding, separate from what is inside it.
  const dotenv = index.files.find(
    (f) => /(^|\/)\.env(\.(local|production|prod))?$/.test(f.path) && !f.isVendor,
  );
  if (dotenv) {
    findings.push({
      ruleId: 'sec.secret.env-committed',
      title: '.env file is committed to version control',
      category: 'security',
      severity: 'critical',
      confidence: 0.97,
      detectedBy: 'security',
      detectors: ['secret-scanner'],
      location: { path: dotenv.path, language: 'Dotenv' },
      summary: `\`${dotenv.path}\` is tracked by git. Environment files exist specifically to keep configuration out of the repository.`,
      impact:
        'Every value in the file is exposed to anyone with repository access, and remains in history after deletion.',
      evidence: [
        {
          kind: 'code',
          label: 'Tracked file',
          detail: `${dotenv.path} (${dotenv.lines.length} lines) is present in the repository archive.`,
          path: dotenv.path,
          source: 'secret-scanner',
        },
        {
          kind: 'absence',
          label: 'gitignore coverage',
          detail: index.file('.gitignore')?.content.includes('.env')
            ? '.gitignore mentions .env, so this file was committed before the rule was added — it stays tracked until it is removed explicitly.'
            : '.gitignore does not exclude .env.',
        },
      ],
      recommendation:
        'Run `git rm --cached .env`, add `.env` to .gitignore, rotate every value it contained, and commit a `.env.example` with placeholder values instead.',
      rootCauseId: 'secrets-in-source',
      cwe: 'CWE-538',
      references: [],
      effortMinutes: 30,
      patch: {
        path: '.gitignore',
        language: 'gitignore',
        requiresReview: false,
        description: 'Stop tracking environment files.',
        diff: [
          '--- a/.gitignore',
          '+++ b/.gitignore',
          '@@',
          ' node_modules/',
          '+',
          '+# Local environment — never commit real values',
          '+.env',
          '+.env.local',
          '+.env.*.local',
        ].join('\n'),
      },
    });
  }

  return { findings, filesScanned, secrets };
}

/** Replaces a secret value inside a rendered snippet so it never leaves the server. */
function redactLineInSnippet(snippet: string | undefined, value: string): string | undefined {
  if (!snippet) return snippet;
  return snippet.split(value).join(maskSecret(value));
}
