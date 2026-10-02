import { describe, expect, it } from 'vitest';
import { decodeScanTicket, encodeScanTicket, scanFromTicket } from '@/lib/scan-token';
import type { ScanTicket } from '@/lib/scan-token';

/**
 * Scan tickets are the only thing standing between "the id is the record" and
 * "the id is whatever the visitor typed". The signature has to be the thing
 * that decides, not the shape.
 */

const ticket = (over: Partial<ScanTicket> = {}): ScanTicket => ({
  repo: {
    owner: 'acme',
    name: 'commerce',
    slug: 'acme/commerce',
    url: 'https://github.com/acme/commerce',
  },
  mode: 'live',
  workspaceId: 'ws_abc123',
  iat: Math.floor(Date.now() / 1000),
  ...over,
});

describe('scan tickets', () => {
  it('round-trips a ticket through an id', () => {
    const decoded = decodeScanTicket(encodeScanTicket(ticket()));
    expect(decoded?.repo.slug).toBe('acme/commerce');
    expect(decoded?.mode).toBe('live');
    expect(decoded?.workspaceId).toBe('ws_abc123');
  });

  it('produces a URL-safe id', () => {
    const id = encodeScanTicket(ticket());
    expect(id).toBe(encodeURIComponent(id));
  });

  it('rejects an id that was never signed', () => {
    expect(decodeScanTicket('scn_ordinary')).toBeNull();
    expect(decodeScanTicket('eph_notbase64.nope')).toBeNull();
    expect(decodeScanTicket('')).toBeNull();
  });

  it('rejects a tampered payload', () => {
    // Re-point the scan at another repository, keeping the valid signature.
    const original = encodeScanTicket(ticket());
    const [, signature] = [original.slice(0, original.lastIndexOf('.')), original.slice(original.lastIndexOf('.') + 1)];
    const forged = Buffer.from(
      JSON.stringify(ticket({ repo: { owner: 'x', name: 'y', slug: 'x/y', url: 'https://github.com/x/y' } })),
      'utf8',
    ).toString('base64url');

    expect(decodeScanTicket(`eph_${forged}.${signature}`)).toBeNull();
  });

  it('rejects a tampered signature', () => {
    const id = encodeScanTicket(ticket());
    const body = id.slice(0, id.lastIndexOf('.'));
    expect(decodeScanTicket(`${body}.${'A'.repeat(43)}`)).toBeNull();
    expect(decodeScanTicket(`${body}.short`)).toBeNull();
  });

  it('expires', () => {
    const old = encodeScanTicket(ticket({ iat: Math.floor(Date.now() / 1000) - 60 * 61 }));
    expect(decodeScanTicket(old)).toBeNull();
  });

  it('rebuilds a queued scan for the workspace that minted it', () => {
    const id = encodeScanTicket(ticket());
    const scan = scanFromTicket(id, 'ws_abc123');
    expect(scan).not.toBeNull();
    expect(scan?.state).toBe('queued');
    expect(scan?.progress).toBe(0);
    expect(scan?.repo.slug).toBe('acme/commerce');
    expect(scan?.agents).toEqual([]);
  });

  it('refuses a ticket presented by a different workspace', () => {
    // Otherwise one visitor could replay another's scan URL and read it.
    const id = encodeScanTicket(ticket());
    expect(scanFromTicket(id, 'ws_someone_else')).toBeNull();
  });

  it('carries the demo mode through', () => {
    const id = encodeScanTicket(ticket({ mode: 'demo' }));
    expect(scanFromTicket(id, 'ws_abc123')?.mode).toBe('demo');
  });
});
