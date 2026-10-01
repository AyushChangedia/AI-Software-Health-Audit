import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FIXTURE_SECRETS } from '@/lib/demo/fixture-secrets';
import { buildDemoIndex } from '@/lib/demo';
import { scanForSecrets } from '@/lib/security/secrets';

/**
 * Sentinel's own source must not contain credential-shaped literals.
 *
 * The sample repository has to contain them — finding them is the whole point
 * of the demo — but they are assembled at runtime so that this repository
 * stays clean. A tool that asks for an exception to its own rules has lost the
 * argument, and GitHub push protection rejects the push anyway.
 */

const ROOT = process.cwd();
const SKIP_DIRS = new Set(['node_modules', '.git', '.next', 'coverage', '.sentinel', 'dist']);

async function sourceFiles(dir = ROOT, acc: string[] = []): Promise<string[]> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      await sourceFiles(path.join(dir, entry.name), acc);
    } else if (/\.(ts|tsx|js|mjs|json|ya?ml|md)$/.test(entry.name)) {
      acc.push(path.join(dir, entry.name));
    }
  }
  return acc;
}

describe('repository hygiene', () => {
  it('contains no literal fixture credential anywhere in source', async () => {
    const files = await sourceFiles();
    // The module that assembles them is the one place allowed to mention the
    // fragments, and even there no whole value appears.
    const offenders: string[] = [];

    for (const file of files) {
      const content = await readFile(file, 'utf8');
      for (const [name, value] of Object.entries(FIXTURE_SECRETS)) {
        if (content.includes(value)) {
          offenders.push(`${path.relative(ROOT, file)} contains ${name}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  }, 30_000);

  it('still assembles those credentials into the demo repository', () => {
    // The guard above must not be satisfiable by weakening the fixtures.
    const index = buildDemoIndex();
    const rules = scanForSecrets(index).findings.map((f) => f.ruleId);
    expect(rules).toContain('sec.secret.stripe-live-key');
    expect(rules).toContain('sec.secret.sendgrid-key');
    expect(rules).toContain('sec.secret.connection-string');
    expect(rules).toContain('sec.secret.env-committed');
  });

  it('ships a .sentinelignore that covers the fixtures', async () => {
    const content = await readFile(path.join(ROOT, '.sentinelignore'), 'utf8');
    expect(content).toContain('src/lib/demo/acme-commerce.ts');
  });

  it('ships a .env.example with no real values', async () => {
    const content = await readFile(path.join(ROOT, '.env.example'), 'utf8');
    // Every assignment is either empty or commented out.
    const assignments = content
      .split('\n')
      .filter((line) => /^[A-Z_]+=/.test(line.trim()))
      .filter((line) => line.split('=')[1]?.trim());

    expect(assignments).toEqual(['APP_URL=http://localhost:3000']);
  });
});
