import type { Severity } from '@/types';

/**
 * Bundled advisory snapshot.
 *
 * Sentinel queries OSV.dev when the host has outbound network access. This
 * snapshot is the offline fallback so dependency analysis still produces real,
 * checkable findings in an air-gapped environment.
 *
 * It is deliberately small and made of advisories that are unambiguous and
 * widely documented. The report always states which source was used, and
 * `live: false` is never presented as complete coverage.
 */

export interface BundledAdvisory {
  ecosystem: 'npm' | 'pypi';
  package: string;
  /** Vulnerable when version < fixedIn. */
  fixedIn: string;
  /** Lower bound, when the advisory does not apply to older majors. */
  introducedIn?: string;
  id: string;
  cve?: string;
  severity: Severity;
  title: string;
  url: string;
}

export const BUNDLED_ADVISORIES: BundledAdvisory[] = [
  {
    ecosystem: 'npm',
    package: 'lodash',
    fixedIn: '4.17.21',
    id: 'GHSA-35jh-r3h4-6jhm',
    cve: 'CVE-2021-23337',
    severity: 'high',
    title: 'Command injection via template',
    url: 'https://github.com/advisories/GHSA-35jh-r3h4-6jhm',
  },
  {
    ecosystem: 'npm',
    package: 'minimist',
    fixedIn: '1.2.6',
    id: 'GHSA-xvch-5gv4-984h',
    cve: 'CVE-2021-44906',
    severity: 'critical',
    title: 'Prototype pollution',
    url: 'https://github.com/advisories/GHSA-xvch-5gv4-984h',
  },
  {
    ecosystem: 'npm',
    package: 'axios',
    fixedIn: '0.21.2',
    id: 'GHSA-cph5-m8f7-6c5x',
    cve: 'CVE-2021-3749',
    severity: 'high',
    title: 'Regular expression denial of service',
    url: 'https://github.com/advisories/GHSA-cph5-m8f7-6c5x',
  },
  {
    ecosystem: 'npm',
    package: 'jsonwebtoken',
    fixedIn: '9.0.0',
    id: 'GHSA-27h2-hvpr-p74q',
    cve: 'CVE-2022-23540',
    severity: 'high',
    title: 'Insecure default algorithm handling in verification',
    url: 'https://github.com/advisories/GHSA-27h2-hvpr-p74q',
  },
  {
    ecosystem: 'npm',
    package: 'node-fetch',
    fixedIn: '2.6.7',
    id: 'GHSA-r683-j2x4-v87g',
    cve: 'CVE-2022-0235',
    severity: 'high',
    title: 'Cookie and authorization headers forwarded across redirects',
    url: 'https://github.com/advisories/GHSA-r683-j2x4-v87g',
  },
  {
    ecosystem: 'npm',
    package: 'semver',
    fixedIn: '7.5.2',
    id: 'GHSA-c2qf-rxjj-qqgw',
    cve: 'CVE-2022-25883',
    severity: 'high',
    title: 'Regular expression denial of service in range parsing',
    url: 'https://github.com/advisories/GHSA-c2qf-rxjj-qqgw',
  },
  {
    ecosystem: 'npm',
    package: 'follow-redirects',
    fixedIn: '1.15.6',
    id: 'GHSA-cxjh-pqwp-8mfp',
    cve: 'CVE-2024-28849',
    severity: 'medium',
    title: 'Proxy-Authorization header leaked across hosts on redirect',
    url: 'https://github.com/advisories/GHSA-cxjh-pqwp-8mfp',
  },
  {
    ecosystem: 'npm',
    package: 'ws',
    fixedIn: '8.17.1',
    id: 'GHSA-3h5v-q93c-6h6q',
    cve: 'CVE-2024-37890',
    severity: 'high',
    title: 'Denial of service via many HTTP headers',
    url: 'https://github.com/advisories/GHSA-3h5v-q93c-6h6q',
  },
  {
    ecosystem: 'npm',
    package: 'express',
    fixedIn: '4.19.2',
    id: 'GHSA-rv95-896h-c2vc',
    cve: 'CVE-2024-29041',
    severity: 'medium',
    title: 'Open redirect in response.location',
    url: 'https://github.com/advisories/GHSA-rv95-896h-c2vc',
  },
  {
    ecosystem: 'npm',
    package: 'moment',
    fixedIn: '2.29.4',
    id: 'GHSA-wc69-rhjr-hc9g',
    cve: 'CVE-2022-31129',
    severity: 'high',
    title: 'Regular expression denial of service in string parsing',
    url: 'https://github.com/advisories/GHSA-wc69-rhjr-hc9g',
  },
  {
    ecosystem: 'npm',
    package: 'tar',
    fixedIn: '6.2.1',
    id: 'GHSA-f5x3-32g6-xq36',
    cve: 'CVE-2024-28863',
    severity: 'medium',
    title: 'Denial of service while parsing a crafted archive',
    url: 'https://github.com/advisories/GHSA-f5x3-32g6-xq36',
  },
  {
    ecosystem: 'pypi',
    package: 'pyyaml',
    fixedIn: '5.4',
    id: 'GHSA-8q59-q68h-6hv4',
    cve: 'CVE-2020-14343',
    severity: 'critical',
    title: 'Arbitrary code execution via full_load / FullLoader',
    url: 'https://github.com/advisories/GHSA-8q59-q68h-6hv4',
  },
  {
    ecosystem: 'pypi',
    package: 'requests',
    fixedIn: '2.31.0',
    id: 'GHSA-j8r2-6x86-q33q',
    cve: 'CVE-2023-32681',
    severity: 'medium',
    title: 'Proxy-Authorization header leaked to destination server',
    url: 'https://github.com/advisories/GHSA-j8r2-6x86-q33q',
  },
  {
    ecosystem: 'pypi',
    package: 'flask',
    fixedIn: '2.2.5',
    id: 'GHSA-m2qf-hxjv-5gpq',
    cve: 'CVE-2023-30861',
    severity: 'high',
    title: 'Session cookie may be cached by a proxy and served to another client',
    url: 'https://github.com/advisories/GHSA-m2qf-hxjv-5gpq',
  },
  {
    ecosystem: 'pypi',
    package: 'urllib3',
    fixedIn: '1.26.18',
    id: 'GHSA-g4mx-q9vg-27p4',
    cve: 'CVE-2023-45803',
    severity: 'medium',
    title: 'Request body not stripped after a 303 redirect',
    url: 'https://github.com/advisories/GHSA-g4mx-q9vg-27p4',
  },
  {
    ecosystem: 'pypi',
    package: 'jinja2',
    fixedIn: '3.1.3',
    id: 'GHSA-h5c8-rqwp-cp95',
    cve: 'CVE-2024-22195',
    severity: 'medium',
    title: 'Cross-site scripting via the xmlattr filter',
    url: 'https://github.com/advisories/GHSA-h5c8-rqwp-cp95',
  },
];

/**
 * Licences worth a second look before shipping a commercial product.
 * This is a prompt to check, never legal advice — the copy says so.
 */
export const LICENSE_RISK: Record<string, { risk: Severity; note: string }> = {
  'AGPL-3.0': {
    risk: 'high',
    note: 'Network copyleft: running a modified version as a service can require publishing your source.',
  },
  'AGPL-3.0-only': { risk: 'high', note: 'Network copyleft obligations apply to hosted services.' },
  'AGPL-3.0-or-later': { risk: 'high', note: 'Network copyleft obligations apply to hosted services.' },
  'GPL-3.0': { risk: 'medium', note: 'Strong copyleft: derivative works must be distributed under the same terms.' },
  'GPL-2.0': { risk: 'medium', note: 'Strong copyleft: derivative works must be distributed under the same terms.' },
  'LGPL-3.0': { risk: 'low', note: 'Weak copyleft: dynamic linking is usually fine, static linking is not.' },
  'SSPL-1.0': { risk: 'high', note: 'Not an OSI-approved licence; service use carries broad source obligations.' },
  'BUSL-1.1': { risk: 'high', note: 'Source-available with usage restrictions until the change date.' },
  'CC-BY-NC-4.0': { risk: 'high', note: 'Non-commercial only.' },
};
