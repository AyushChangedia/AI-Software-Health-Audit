import { describe, expect, it } from 'vitest';
import { createRedactor, maskSecret, scanForSecrets, shannonEntropy } from '@/lib/security/secrets';
import { RepoIndex, buildRepoFile, type RepoFile } from '@/lib/analysis/repo-index';
import { DEMO_REPO } from '@/lib/demo';
import { FIXTURE_SECRETS } from '@/lib/demo/fixture-secrets';

function indexOf(files: Record<string, string>): RepoIndex {
  const built: RepoFile[] = [];
  for (const [path, content] of Object.entries(files)) {
    const file = buildRepoFile(path, new TextEncoder().encode(content));
    if (file) built.push(file);
  }
  return new RepoIndex(DEMO_REPO, 'demo', built, {
    totalFiles: built.length,
    skippedFiles: 0,
    truncated: false,
    totalBytes: 0,
  });
}

describe('shannonEntropy', () => {
  it('is zero for a single repeated character', () => {
    expect(shannonEntropy('aaaaaaaa')).toBe(0);
  });
  it('rises with variety', () => {
    expect(shannonEntropy('aB3$xK9!mQ2#')).toBeGreaterThan(shannonEntropy('aaaabbbb'));
  });
  it('handles the empty string', () => {
    expect(shannonEntropy('')).toBe(0);
  });
});

describe('maskSecret', () => {
  it('keeps only the ends', () => {
    const masked = maskSecret('ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345');
    expect(masked.startsWith('ghp_')).toBe(true);
    expect(masked.endsWith('2345')).toBe(true);
    expect(masked).not.toContain('MNOPQRST');
  });
  it('fully masks a short value', () => {
    expect(maskSecret('short')).toBe('••••••••');
  });
});

describe('scanForSecrets', () => {
  it('detects vendor-format credentials', () => {
    const index = indexOf({
      'src/config.ts': [
        "export const key = 'AKIA4KJ7WQ2LZXTB9RMD';",
        "export const gh = 'ghp_9fKz2LmQ7pRt4XwVbN8cYdE1sHjG6uA0iToP';",
      ].join('\n'),
    });
    const { findings } = scanForSecrets(index);
    const rules = findings.map((f) => f.ruleId);
    expect(rules).toContain('sec.secret.aws-access-key');
    expect(rules).toContain('sec.secret.github-pat');
  });

  it('does not flag the documented AWS example key', () => {
    // AKIAIOSFODNN7EXAMPLE appears in every AWS tutorial. Reporting it as a
    // live credential is the kind of false positive that makes people stop
    // reading the whole report.
    const index = indexOf({ 'docs/setup.md': "aws_access_key_id = AKIAIOSFODNN7EXAMPLE" });
    expect(scanForSecrets(index).findings).toHaveLength(0);
  });

  it('never renders the raw value', () => {
    const secret = 'ghp_9fKz2LmQ7pRt4XwVbN8cYdE1sHjG6uA0iToP';
    const index = indexOf({ 'src/config.ts': `const t = '${secret}';` });
    const { findings } = scanForSecrets(index);
    expect(JSON.stringify(findings)).not.toContain(secret);
  });

  it('ignores placeholders', () => {
    const index = indexOf({
      'src/config.ts': [
        "const apiKey = 'your-api-key-here';",
        "const secret = process.env.SECRET;",
        "const token = 'xxxxxxxxxxxxxxxx';",
        "const password = 'changeme-please';",
      ].join('\n'),
    });
    const { findings } = scanForSecrets(index);
    expect(findings.filter((f) => f.ruleId === 'sec.secret.generic-credential')).toHaveLength(0);
  });

  it('ignores low-entropy values under the generic rule', () => {
    const index = indexOf({ 'src/config.ts': "const password = 'aaaaaaaaaaaaaaaa';" });
    const { findings } = scanForSecrets(index);
    expect(findings).toHaveLength(0);
  });

  it('downgrades a match in a template file', () => {
    const real = indexOf({ '.env.local': `STRIPE=${FIXTURE_SECRETS.stripeLiveKey}` });
    const template = indexOf({ '.env.example': `STRIPE=${FIXTURE_SECRETS.stripeLiveKey}` });

    const realFinding = scanForSecrets(real).findings.find((f) => f.ruleId.includes('stripe'));
    const templateFinding = scanForSecrets(template).findings.find((f) =>
      f.ruleId.includes('stripe'),
    );

    expect(realFinding?.severity).toBe('critical');
    expect(templateFinding?.severity).toBe('low');
    expect(templateFinding!.confidence).toBeLessThan(realFinding!.confidence);
  });

  it('flags a committed .env separately from its contents', () => {
    const index = indexOf({ '.env': 'DEBUG=1\n', '.gitignore': 'node_modules/\n' });
    const { findings } = scanForSecrets(index);
    const committed = findings.find((f) => f.ruleId === 'sec.secret.env-committed');
    expect(committed).toBeDefined();
    expect(committed!.severity).toBe('critical');
    expect(committed!.patch).toBeDefined();
  });

  it('notes when .gitignore already lists .env but the file is still tracked', () => {
    const index = indexOf({ '.env': 'A=1\n', '.gitignore': '.env\n' });
    const finding = scanForSecrets(index).findings.find(
      (f) => f.ruleId === 'sec.secret.env-committed',
    );
    expect(finding!.evidence.some((e) => e.detail.includes('before the rule was added'))).toBe(true);
  });

  it('skips vendored and lock files', () => {
    const index = indexOf({
      'node_modules/pkg/index.js': "const k = 'AKIA4KJ7WQ2LZXTB9RMD';",
      'package-lock.json': '{"x":"AKIA4KJ7WQ2LZXTB9RMD"}',
    });
    expect(scanForSecrets(index).findings).toHaveLength(0);
  });
});

describe('createRedactor', () => {
  it('masks every known value wherever it appears', () => {
    const redact = createRedactor(['supersecretvalue1', 'anothersecret22']);
    const text = 'a supersecretvalue1 b anothersecret22 c';
    const out = redact(text);
    expect(out).not.toContain('supersecretvalue1');
    expect(out).not.toContain('anothersecret22');
  });

  it('is a no-op with nothing to redact', () => {
    expect(createRedactor([])('unchanged')).toBe('unchanged');
  });

  it('ignores values too short to be credentials', () => {
    expect(createRedactor(['abc'])('abc def')).toBe('abc def');
  });
});
