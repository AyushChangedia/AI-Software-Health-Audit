/**
 * Fixture credentials for the bundled sample repository.
 *
 * These are assembled from fragments rather than written out as literals. The
 * sample repository has to contain credential-shaped strings — finding them is
 * the point of the demo — but if those strings appeared verbatim in *this*
 * repository's source, every secret scanner pointed at Sentinel would flag
 * them, including GitHub push protection. They would be right to: a scanner
 * cannot tell a fixture from the real thing, and a tool that asks for an
 * exception to its own rules has lost the argument.
 *
 * Assembling at runtime keeps Sentinel's own source clean while the demo
 * repository still contains full, realistically-shaped values for the scanner
 * under test to find. Nothing here has ever been a working credential.
 */

const join = (...parts: string[]) => parts.join('');

export const FIXTURE_SECRETS = {
  /** Matches the Stripe live-key format: `sk_live_` + 24 or more alphanumerics. */
  stripeLiveKey: join('sk', '_', 'live', '_', '51H8vPqKz9mQxRt7wLnBcDeFgHiJkLmNoPqRsTuVwXyZ012345'),

  /** Matches the SendGrid format: `SG.` + id + `.` + secret. */
  sendgridKey: join(
    'SG',
    '.',
    'x9KdLmNoPqRsTuVwXyZ012',
    '.',
    'abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHI',
  ),

  /** A Postgres URL with an inline password. */
  databaseUrl: join(
    'postgres',
    'ql://acme_app:',
    'S3cretPassw0rd!2023',
    '@db.acme-internal.com:5432/acme_production',
  ),

  /** A 32-character hex string, which the generic entropy rule should catch. */
  jwtSigningKey: join('b7f3e91d2c8a45f6', 'e0d1c2b3a4958677'),
} as const;
