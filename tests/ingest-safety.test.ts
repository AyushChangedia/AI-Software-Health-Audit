import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { isSafeEntryPath, readTarGz, stripRoot } from '@/lib/analysis/tar';
import { buildRepoFile } from '@/lib/analysis/repo-index';

/**
 * Repository archives are attacker-controlled input. These tests are the
 * contract for what the reader refuses to hand back.
 */

const BLOCK = 512;

function octal(value: number, length: number): string {
  return value.toString(8).padStart(length - 1, '0') + '\0';
}

/** Builds a single ustar entry. */
function entry(path: string, body: string, typeFlag = '0'): Buffer {
  const header = Buffer.alloc(BLOCK, 0);
  header.write(path.slice(0, 100), 0, 'utf8');
  header.write(octal(0o644, 8), 100, 'utf8');
  header.write(octal(0, 8), 108, 'utf8');
  header.write(octal(0, 8), 116, 'utf8');
  header.write(octal(Buffer.byteLength(body), 12), 124, 'utf8');
  header.write(octal(0, 12), 136, 'utf8');
  header.write('        ', 148, 'utf8'); // checksum placeholder
  header.write(typeFlag, 156, 'utf8');
  header.write('ustar\0', 257, 'utf8');
  header.write('00', 263, 'utf8');

  // Checksum over the header with the checksum field treated as spaces.
  let sum = 0;
  for (const byte of header) sum += byte;
  header.write(octal(sum, 8), 148, 'utf8');

  const content = Buffer.alloc(Math.ceil(Buffer.byteLength(body) / BLOCK) * BLOCK, 0);
  content.write(body, 0, 'utf8');
  return Buffer.concat([header, content]);
}

function archive(entries: Buffer[]): Uint8Array {
  return gzipSync(Buffer.concat([...entries, Buffer.alloc(BLOCK * 2, 0)]));
}

const LIMITS = { maxTotalBytes: 5_000_000, maxFileBytes: 100_000, maxFiles: 100 };

describe('isSafeEntryPath', () => {
  it('rejects traversal, absolute and drive paths', () => {
    expect(isSafeEntryPath('../etc/passwd')).toBe(false);
    expect(isSafeEntryPath('a/../../b')).toBe(false);
    expect(isSafeEntryPath('/etc/passwd')).toBe(false);
    expect(isSafeEntryPath('\\windows\\system32')).toBe(false);
    expect(isSafeEntryPath('C:/windows')).toBe(false);
    expect(isSafeEntryPath('a/\0/b')).toBe(false);
    expect(isSafeEntryPath('')).toBe(false);
  });

  it('accepts ordinary repository paths', () => {
    expect(isSafeEntryPath('src/index.ts')).toBe(true);
    expect(isSafeEntryPath('.github/workflows/ci.yml')).toBe(true);
  });
});

describe('stripRoot', () => {
  it('removes the archive wrapper directory', () => {
    expect(stripRoot('owner-repo-abc123/src/a.ts', 'owner-repo-abc123')).toBe('src/a.ts');
  });
  it('leaves other paths alone', () => {
    expect(stripRoot('src/a.ts', null)).toBe('src/a.ts');
  });
});

describe('readTarGz', () => {
  it('reads regular files and strips the wrapper directory', () => {
    const result = readTarGz(
      archive([
        entry('repo-main/src/index.ts', 'export const x = 1;\n'),
        entry('repo-main/README.md', '# hi\n'),
      ]),
      LIMITS,
    );
    expect(result.root).toBe('repo-main');
    expect(result.entries.map((e) => e.path).sort()).toEqual(['README.md', 'src/index.ts']);
  });

  it('skips symlinks and hardlinks rather than following them', () => {
    const result = readTarGz(
      archive([
        entry('repo-main/real.ts', 'ok\n'),
        entry('repo-main/link.ts', '/etc/passwd', '2'),
        entry('repo-main/hard.ts', '/etc/shadow', '1'),
      ]),
      LIMITS,
    );
    expect(result.entries.map((e) => e.path)).toEqual(['real.ts']);
  });

  it('skips directory entries', () => {
    const result = readTarGz(
      archive([entry('repo-main/src/', '', '5'), entry('repo-main/src/a.ts', 'x\n')]),
      LIMITS,
    );
    expect(result.entries).toHaveLength(1);
  });

  it('refuses a traversal path', () => {
    const result = readTarGz(
      archive([entry('repo-main/ok.ts', 'x\n'), entry('../../../etc/passwd', 'root:x:0:0\n')]),
      LIMITS,
    );
    expect(result.entries.map((e) => e.path)).toEqual(['ok.ts']);
    expect(result.skipped).toBeGreaterThan(0);
  });

  it('skips files over the per-file cap', () => {
    const result = readTarGz(
      archive([entry('repo-main/big.ts', 'x'.repeat(2_000)), entry('repo-main/small.ts', 'x')]),
      { ...LIMITS, maxFileBytes: 1_000 },
    );
    expect(result.entries.map((e) => e.path)).toEqual(['small.ts']);
    expect(result.skipped).toBe(1);
  });

  it('stops at the file-count cap and reports truncation', () => {
    const many = Array.from({ length: 10 }, (_, i) => entry(`repo-main/f${i}.ts`, 'x'));
    const result = readTarGz(archive(many), { ...LIMITS, maxFiles: 4 });
    expect(result.entries).toHaveLength(4);
    expect(result.truncated).toBe(true);
  });

  it('honours the accept predicate', () => {
    const result = readTarGz(
      archive([entry('repo-main/a.ts', 'x'), entry('repo-main/b.png', 'x')]),
      { ...LIMITS, accept: (path) => !path.endsWith('.png') },
    );
    expect(result.entries.map((e) => e.path)).toEqual(['a.ts']);
  });

  it('refuses an archive that expands past the total cap', () => {
    // Highly compressible content: small gzip, large expansion.
    const bomb = archive([entry('repo-main/bomb.txt', 'A'.repeat(200_000))]);
    expect(() => readTarGz(bomb, { ...LIMITS, maxTotalBytes: 50_000 })).toThrow(/size limit/i);
  });

  it('refuses input that is not gzip', () => {
    expect(() => readTarGz(new Uint8Array([1, 2, 3, 4]), LIMITS)).toThrow(/gzip/i);
  });
});

describe('buildRepoFile', () => {
  it('rejects binary content', () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0x1a, 0x0a]);
    expect(buildRepoFile('image.png', bytes)).toBeNull();
  });

  it('classifies tests, vendor and generated files', () => {
    const encode = (text: string) => new TextEncoder().encode(text);
    expect(buildRepoFile('src/a.test.ts', encode('x'))!.isTest).toBe(true);
    expect(buildRepoFile('node_modules/x/index.js', encode('x'))!.isVendor).toBe(true);
    expect(buildRepoFile('src/types.d.ts', encode('x'))!.isGenerated).toBe(true);
    expect(buildRepoFile('docs/guide.md', encode('x'))!.isDoc).toBe(true);
  });

  it('counts lines of code without comments or blanks', () => {
    const file = buildRepoFile(
      'src/a.ts',
      new TextEncoder().encode('const a = 1;\n\n// a comment\nconst b = 2;\n'),
    );
    expect(file!.loc).toBe(2);
  });
});
