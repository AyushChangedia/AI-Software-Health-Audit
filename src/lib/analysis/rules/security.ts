import type { PatternRule } from '../rule-engine';
import { BACKEND_LANGS, JS_LANGS, PY_LANGS, USER_INPUT } from '../rule-engine';

const OWASP_INJECTION = 'A03:2021 Injection';

/**
 * Security rules.
 *
 * Every rule points at a line. Confidence is the *detector's* confidence that
 * the pattern is real — the validator is what decides whether it is reachable.
 */
export const SECURITY_RULES: PatternRule[] = [
  {
    id: 'sec.sql-injection',
    joinLines: 3,
    title: 'SQL query built by string concatenation',
    category: 'security',
    agent: 'security',
    severity: 'critical',
    confidence: 0.78,
    languages: BACKEND_LANGS,
    pattern:
      /(?:query|execute|exec|raw|rawQuery|queryRaw|executeRaw)\s*\(\s*(?:`[^`]*\$\{|['"][^'"]*['"]\s*\+|f['"])/i,
    excludeLine: /\$\d|\?\s*[,)]|:\w+\s*[,)]|prepared|placeholder/i,
    cwe: 'CWE-89',
    owasp: OWASP_INJECTION,
    rootCauseId: 'unparameterised-queries',
    effortMinutes: 40,
    summary: (ctx) =>
      `\`${ctx.match.file.path}:${ctx.match.line}\` builds a SQL statement by interpolating values into the query text instead of binding them as parameters.`,
    impact:
      'If any interpolated value reaches this line from a request, an attacker controls the query. That means reading every row the database user can see, and in many configurations writing them too.',
    recommendation:
      'Use parameter binding — `$1`/`?` placeholders with a values array, or your ORM query builder. Never interpolate into SQL text, even for values you believe are internal.',
    evidence: (ctx) => [
      {
        kind: 'code',
        label: 'Interpolated query',
        detail: ctx.match.text.trim().slice(0, 240),
        path: ctx.match.file.path,
        line: ctx.match.line,
        source: 'pattern-rules',
      },
      {
        kind: 'reasoning',
        label: 'Why concatenation is the problem',
        detail:
          'A bound parameter is sent to the database separately from the statement, so its content can never change the statement structure. Interpolation merges the two.',
      },
    ],
    dataFlow: (ctx) => [
      { label: 'Request input', detail: 'Query string, body or path parameter' },
      { label: 'Handler', path: ctx.match.file.path },
      {
        label: 'Query construction',
        path: ctx.match.file.path,
        line: ctx.match.line,
        vulnerable: true,
        detail: 'Value is interpolated directly into SQL text',
      },
      { label: 'Database', detail: 'Statement executed with the application user privileges' },
    ],
    references: [
      { label: 'CWE-89: SQL Injection', url: 'https://cwe.mitre.org/data/definitions/89.html' },
      { label: 'OWASP: SQL Injection Prevention', url: 'https://cheatsheetseries.owasp.org/cheatsheets/SQL_Injection_Prevention_Cheat_Sheet.html' },
    ],
    patch: (ctx) => ({
      path: ctx.match.file.path,
      language: ctx.match.file.language,
      requiresReview: true,
      description: 'Bind the value as a parameter instead of interpolating it.',
      diff: [
        `--- a/${ctx.match.file.path}`,
        `+++ b/${ctx.match.file.path}`,
        `@@ -${ctx.match.line},1 +${ctx.match.line},1 @@`,
        `-${ctx.match.text}`,
        `+${ctx.match.text.replace(/\$\{([^}]+)\}/g, '$1').replace(/`([^`]*)`/, "'$1'")} // TODO: pass values as the second argument`,
      ].join('\n'),
    }),
  },
  {
    id: 'sec.command-injection',
    joinLines: 3,
    title: 'Shell command built from a dynamic value',
    category: 'security',
    agent: 'security',
    severity: 'critical',
    confidence: 0.8,
    languages: BACKEND_LANGS,
    pattern:
      /(?:child_process\.)?(?:exec|execSync|spawn|spawnSync)\s*\(\s*[`'"][^`'"]*(?:\$\{|['"]\s*\+)|os\.system\s*\(\s*f?['"]|subprocess\.[a-z]+\([^)]*shell\s*=\s*True/,
    cwe: 'CWE-78',
    owasp: OWASP_INJECTION,
    rootCauseId: 'unsafe-shell-usage',
    effortMinutes: 45,
    summary: (ctx) =>
      `A shell command in \`${ctx.match.file.path}:${ctx.match.line}\` is assembled from a dynamic value. Anything that reaches the interpolated slot is interpreted by the shell.`,
    impact:
      'Shell metacharacters (`;`, `&&`, backticks) turn a single command into arbitrary code execution on the host with the process user privileges.',
    recommendation:
      'Pass the command and its arguments as an array (`execFile`, `spawn` without `shell: true`, `subprocess.run([...])`). If a shell is genuinely required, allow-list the input against a fixed set.',
    references: [
      { label: 'CWE-78: OS Command Injection', url: 'https://cwe.mitre.org/data/definitions/78.html' },
    ],
  },
  {
    id: 'sec.eval-usage',
    title: 'Dynamic code evaluation',
    category: 'security',
    agent: 'security',
    severity: 'high',
    confidence: 0.72,
    languages: [...JS_LANGS, ...PY_LANGS],
    pattern: /\b(?:eval|new\s+Function|vm\.runInNewContext)\s*\(|\bexec\s*\(\s*f?['"]/,
    excludeLine: /eslint|\/\/|#\s|safeEval/,
    cwe: 'CWE-95',
    owasp: OWASP_INJECTION,
    rootCauseId: 'unsafe-dynamic-execution',
    effortMinutes: 60,
    summary: (ctx) =>
      `\`${ctx.match.file.path}:${ctx.match.line}\` evaluates code at runtime. Every value that reaches it becomes executable.`,
    impact:
      'Dynamic evaluation converts a data-handling bug into arbitrary code execution inside your process, with access to environment variables and network.',
    recommendation:
      'Replace evaluation with an explicit parser or a lookup table. For JSON use `JSON.parse`; for expressions use a sandboxed expression library with an allow-list of operations.',
    references: [
      { label: 'CWE-95: Eval Injection', url: 'https://cwe.mitre.org/data/definitions/95.html' },
    ],
  },
  {
    id: 'sec.ssrf',
    joinLines: 2,
    title: 'Outbound request to a caller-controlled URL',
    category: 'security',
    agent: 'security',
    severity: 'high',
    confidence: 0.66,
    languages: BACKEND_LANGS,
    pattern:
      /(?:fetch|axios(?:\.(?:get|post|put|delete|request))?|got|request|urllib\.request\.urlopen|requests\.(?:get|post))\s*\(\s*(?:req\.|request\.|params|url|target|endpoint|body\.|query\.)/,
    excludeLine: /allowlist|allowList|whitelist|isAllowedHost|URL_ALLOWLIST/i,
    pathFilter: (p) => !/\.test\.|\.spec\./.test(p),
    cwe: 'CWE-918',
    owasp: 'A10:2021 Server-Side Request Forgery',
    rootCauseId: 'unvalidated-outbound-requests',
    effortMinutes: 50,
    summary: (ctx) =>
      `\`${ctx.match.file.path}:${ctx.match.line}\` makes a server-side HTTP request to a URL that appears to come from the caller.`,
    impact:
      'The server can be used as a proxy into the private network: cloud metadata endpoints (169.254.169.254), internal admin panels, and services that trust anything originating inside the VPC.',
    recommendation:
      'Resolve the host and reject private, loopback and link-local addresses before connecting; then check the host against an allow-list. Do the check after DNS resolution, not on the raw string — `http://x.internal` and a DNS rebind both bypass string checks.',
    references: [
      { label: 'OWASP: SSRF Prevention', url: 'https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html' },
    ],
    dataFlow: (ctx) => [
      { label: 'Request input', detail: 'Caller supplies a URL' },
      { label: 'Handler', path: ctx.match.file.path },
      {
        label: 'Outbound fetch',
        path: ctx.match.file.path,
        line: ctx.match.line,
        vulnerable: true,
        detail: 'No post-resolution host check found nearby',
      },
      { label: 'Internal network', detail: 'Cloud metadata, internal services' },
    ],
  },
  {
    id: 'sec.path-traversal',
    joinLines: 2,
    title: 'File path built from request input',
    category: 'security',
    agent: 'security',
    severity: 'high',
    confidence: 0.7,
    languages: BACKEND_LANGS,
    pattern:
      /(?:readFile|readFileSync|createReadStream|sendFile|open|unlink|writeFile)\s*\(\s*(?:path\.join\s*\(\s*)?[^)]*(?:req\.|request\.|params\.|query\.|body\.)/,
    excludeLine: /basename|sanitiz|normalize.*startsWith|resolve.*startsWith/i,
    cwe: 'CWE-22',
    owasp: 'A01:2021 Broken Access Control',
    rootCauseId: 'unvalidated-filesystem-paths',
    effortMinutes: 35,
    summary: (ctx) =>
      `\`${ctx.match.file.path}:${ctx.match.line}\` builds a filesystem path from request input without a containment check.`,
    impact:
      '`../../../etc/passwd` and its encoded variants let a caller read or overwrite files outside the intended directory.',
    recommendation:
      'Resolve the final path and assert it still starts with the intended root directory, or map the input through an allow-list of known identifiers instead of using it as a path.',
    references: [
      { label: 'CWE-22: Path Traversal', url: 'https://cwe.mitre.org/data/definitions/22.html' },
    ],
  },
  {
    id: 'sec.xss-dangerous-html',
    title: 'Unescaped HTML injected into the DOM',
    category: 'security',
    agent: 'security',
    severity: 'high',
    confidence: 0.68,
    languages: JS_LANGS,
    pattern: /dangerouslySetInnerHTML|\.innerHTML\s*=|v-html\s*=|\.outerHTML\s*=/,
    excludeLine: /DOMPurify|sanitize|sanitiz/i,
    cwe: 'CWE-79',
    owasp: 'A03:2021 Injection',
    rootCauseId: 'unescaped-output',
    effortMinutes: 30,
    summary: (ctx) =>
      `\`${ctx.match.file.path}:${ctx.match.line}\` writes raw HTML into the document without a sanitiser on the same line.`,
    impact:
      'If any part of the injected string is influenced by user content, an attacker can run script in the victim session: session theft, silent actions as the user, credential capture.',
    recommendation:
      'Render text as text — JSX children, `textContent`, template escaping. When rich HTML is genuinely required, run it through DOMPurify with a strict allow-list immediately before injection.',
    references: [
      { label: 'OWASP: XSS Prevention', url: 'https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html' },
    ],
  },
  {
    id: 'sec.weak-hash',
    title: 'Broken hash algorithm',
    category: 'security',
    agent: 'security',
    severity: 'medium',
    confidence: 0.88,
    languages: BACKEND_LANGS,
    pattern: /createHash\s*\(\s*['"](?:md5|sha1)['"]|hashlib\.(?:md5|sha1)\s*\(|MessageDigest\.getInstance\s*\(\s*"(?:MD5|SHA-?1)"/i,
    cwe: 'CWE-327',
    rootCauseId: 'weak-cryptography',
    effortMinutes: 25,
    summary: (ctx) =>
      `MD5/SHA-1 is used at \`${ctx.match.file.path}:${ctx.match.line}\`. Both have practical collision attacks.`,
    impact:
      'For integrity checks or signatures, collisions let an attacker substitute content. For password storage, these are fast by design and fall to GPU cracking in minutes.',
    recommendation:
      'Use SHA-256 for integrity and a memory-hard KDF (argon2id, scrypt or bcrypt) for passwords. If the hash is only a cache key, say so in a comment so the next reader does not have to guess.',
    references: [
      { label: 'CWE-327: Broken Crypto', url: 'https://cwe.mitre.org/data/definitions/327.html' },
    ],
  },
  {
    id: 'sec.insecure-random',
    title: 'Non-cryptographic randomness used for a security value',
    category: 'security',
    agent: 'security',
    severity: 'high',
    confidence: 0.74,
    languages: BACKEND_LANGS,
    pattern: /(?:token|secret|nonce|otp|reset|session|apiKey|api_key|password)[^=\n]{0,30}=\s*[^\n]*Math\.random\s*\(|random\.(?:random|randint|choice)\s*\([^)]*\)\s*(?:#[^\n]*)?$/i,
    cwe: 'CWE-338',
    rootCauseId: 'weak-cryptography',
    effortMinutes: 20,
    summary: (ctx) =>
      `\`${ctx.match.file.path}:${ctx.match.line}\` derives a security-sensitive value from a pseudo-random generator that is not cryptographically secure.`,
    impact:
      'PRNG output is predictable from a handful of observed values. An attacker who can request a few tokens can compute the next ones and take over accounts.',
    recommendation:
      'Use `crypto.randomUUID()` / `crypto.randomBytes()` in Node, `secrets` in Python, or `crypto/rand` in Go.',
    references: [
      { label: 'CWE-338: Weak PRNG', url: 'https://cwe.mitre.org/data/definitions/338.html' },
    ],
  },
  {
    id: 'sec.jwt-unverified',
    title: 'JWT accepted without signature verification',
    category: 'security',
    agent: 'security',
    severity: 'critical',
    confidence: 0.84,
    languages: BACKEND_LANGS,
    pattern:
      /jwt\.decode\s*\(|verify\s*:\s*false|algorithms\s*:\s*\[\s*['"]none['"]|verify_signature['"]?\s*:\s*False|options\s*=\s*\{\s*['"]verify_signature['"]\s*:\s*False/i,
    excludeLine: /jwt\.decode\([^)]*verify\s*=\s*True/i,
    cwe: 'CWE-347',
    owasp: 'A07:2021 Identification and Authentication Failures',
    rootCauseId: 'auth-trust-boundary',
    effortMinutes: 40,
    summary: (ctx) =>
      `\`${ctx.match.file.path}:${ctx.match.line}\` reads a JWT without verifying its signature.`,
    impact:
      'A JWT is only a trust statement because of its signature. Decoding without verifying means any caller can mint a token with any claims — including another user id or an admin role.',
    recommendation:
      'Always call the verifying API (`jwt.verify`) with an explicit algorithm allow-list and the expected issuer and audience. Never accept `alg: none`.',
    references: [
      { label: 'CWE-347: Improper Verification of Cryptographic Signature', url: 'https://cwe.mitre.org/data/definitions/347.html' },
    ],
  },
  {
    id: 'sec.tls-verification-disabled',
    title: 'TLS certificate verification disabled',
    category: 'security',
    agent: 'security',
    severity: 'high',
    confidence: 0.92,
    languages: BACKEND_LANGS,
    pattern:
      /rejectUnauthorized\s*:\s*false|NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*['"]?0|verify\s*=\s*False|InsecureSkipVerify\s*:\s*true/,
    cwe: 'CWE-295',
    rootCauseId: 'weak-transport-security',
    effortMinutes: 30,
    summary: (ctx) =>
      `Certificate validation is switched off at \`${ctx.match.file.path}:${ctx.match.line}\`.`,
    impact:
      'Without certificate validation, TLS provides encryption but no authentication — anyone able to intercept the connection can present their own certificate and read or modify the traffic.',
    recommendation:
      'Remove the flag. If the target uses a private CA, add that CA to the trust store instead of disabling verification globally.',
    references: [
      { label: 'CWE-295: Improper Certificate Validation', url: 'https://cwe.mitre.org/data/definitions/295.html' },
    ],
  },
  {
    id: 'sec.cors-wildcard',
    title: 'Permissive CORS configuration',
    category: 'security',
    agent: 'security',
    severity: 'medium',
    confidence: 0.8,
    pattern:
      /Access-Control-Allow-Origin['"]?\s*[,:]\s*['"]\*|origin\s*:\s*true|cors\s*\(\s*\{\s*origin\s*:\s*['"]\*/,
    cwe: 'CWE-942',
    owasp: 'A05:2021 Security Misconfiguration',
    rootCauseId: 'permissive-configuration',
    effortMinutes: 20,
    summary: (ctx) =>
      `\`${ctx.match.file.path}:${ctx.match.line}\` allows any origin to call this API from a browser.`,
    impact:
      'Combined with cookie-based sessions, a wildcard origin lets any website read authenticated responses on behalf of a logged-in visitor.',
    recommendation:
      'List the origins you actually serve. If the API is genuinely public and unauthenticated, keep the wildcard but make sure credentials are not accepted.',
    references: [],
  },
  {
    id: 'sec.insecure-cookie',
    title: 'Session cookie missing protective flags',
    category: 'security',
    agent: 'security',
    severity: 'medium',
    confidence: 0.75,
    pattern: /httpOnly\s*:\s*false|secure\s*:\s*false|sameSite\s*:\s*['"]none['"]/i,
    cwe: 'CWE-1004',
    rootCauseId: 'permissive-configuration',
    effortMinutes: 15,
    summary: (ctx) =>
      `A cookie is configured at \`${ctx.match.file.path}:${ctx.match.line}\` without the protections that keep it away from scripts and plaintext connections.`,
    impact:
      '`httpOnly: false` exposes the cookie to any XSS on the page. `secure: false` lets it travel over plain HTTP. `sameSite: none` re-opens CSRF.',
    recommendation:
      'Set `httpOnly: true`, `secure: true` and `sameSite: "lax"` (or `strict`) for session cookies. Only relax a flag with a written reason.',
    references: [],
  },
  {
    id: 'sec.open-redirect',
    title: 'Redirect target taken from request input',
    category: 'security',
    agent: 'security',
    severity: 'medium',
    confidence: 0.72,
    languages: BACKEND_LANGS,
    pattern: /redirect\s*\(\s*(?:req\.(?:query|body|params)|request\.(?:args|form)|params\.)/,
    excludeLine: /startsWith\s*\(\s*['"]\//,
    cwe: 'CWE-601',
    rootCauseId: 'unvalidated-redirects',
    effortMinutes: 20,
    summary: (ctx) =>
      `\`${ctx.match.file.path}:${ctx.match.line}\` redirects to a location supplied by the caller.`,
    impact:
      'Phishing links that begin with your real domain are far more effective. Open redirects are also used to leak OAuth codes and tokens to attacker-controlled hosts.',
    recommendation:
      'Accept a relative path only (must start with a single `/`), or map an opaque key to a known destination.',
    references: [],
  },
  {
    id: 'sec.unsafe-deserialization',
    joinLines: 2,
    title: 'Unsafe deserialization of untrusted data',
    category: 'security',
    agent: 'security',
    severity: 'critical',
    confidence: 0.86,
    pattern: /pickle\.loads?\s*\(|yaml\.load\s*\((?![^)]*SafeLoader)|marshal\.loads\s*\(|unserialize\s*\(/,
    cwe: 'CWE-502',
    owasp: 'A08:2021 Software and Data Integrity Failures',
    rootCauseId: 'unsafe-dynamic-execution',
    effortMinutes: 45,
    summary: (ctx) =>
      `\`${ctx.match.file.path}:${ctx.match.line}\` deserializes data with an API that can construct arbitrary objects.`,
    impact:
      'These formats can encode constructor calls. A crafted payload runs code during parsing, before any of your validation logic sees it.',
    recommendation:
      'Use `yaml.safe_load`, JSON, or an explicit schema decoder. Never deserialize data that crossed a trust boundary with pickle or marshal.',
    references: [
      { label: 'CWE-502: Deserialization of Untrusted Data', url: 'https://cwe.mitre.org/data/definitions/502.html' },
    ],
  },
  {
    id: 'sec.debug-enabled',
    title: 'Debug mode enabled in committed configuration',
    category: 'security',
    agent: 'security',
    severity: 'medium',
    confidence: 0.8,
    pattern: /DEBUG\s*[:=]\s*(?:True|true|1)\b|app\.run\s*\([^)]*debug\s*=\s*True|NODE_ENV\s*=\s*['"]?development/,
    pathFilter: (p) => !/\.test\.|\.spec\.|example|sample/i.test(p),
    cwe: 'CWE-489',
    owasp: 'A05:2021 Security Misconfiguration',
    rootCauseId: 'permissive-configuration',
    effortMinutes: 15,
    summary: (ctx) =>
      `Debug mode is switched on in \`${ctx.match.file.path}:${ctx.match.line}\`, which is committed to the repository.`,
    impact:
      'Debug handlers render stack traces, local variables and sometimes an interactive console to whoever triggers an error.',
    recommendation:
      'Drive the flag from an environment variable that defaults to off, and assert it is off when NODE_ENV/ENV is production.',
    references: [],
  },
  {
    id: 'sec.mass-assignment',
    joinLines: 2,
    title: 'Request body passed straight into a model write',
    category: 'security',
    agent: 'security',
    severity: 'high',
    confidence: 0.7,
    languages: BACKEND_LANGS,
    pattern:
      /(?:create|update|updateOne|findOneAndUpdate|save|insert|bulkCreate)\s*\(\s*\{?\s*(?:data\s*:\s*)?(?:req\.body|request\.(?:json|form|data)|body)\s*[,)}]/,
    cwe: 'CWE-915',
    owasp: 'A01:2021 Broken Access Control',
    rootCauseId: 'missing-input-validation',
    effortMinutes: 35,
    summary: (ctx) =>
      `\`${ctx.match.file.path}:${ctx.match.line}\` writes the whole request body to the database.`,
    impact:
      'Any column the model exposes becomes writable, including fields the UI never shows — `role`, `isAdmin`, `credits`, `verified`, `ownerId`.',
    recommendation:
      'Parse the body through a schema that lists exactly the fields a caller may set, and write only the parsed result.',
    references: [
      { label: 'CWE-915: Improperly Controlled Modification of Object Attributes', url: 'https://cwe.mitre.org/data/definitions/915.html' },
    ],
  },
  {
    id: 'sec.unvalidated-input',
    title: 'Handler reads request input with no schema validation',
    category: 'security',
    agent: 'security',
    severity: 'medium',
    confidence: 0.55,
    languages: BACKEND_LANGS,
    pattern: USER_INPUT,
    pathFilter: (p) =>
      /(^|\/)(api|routes?|controllers?|handlers?)(\/|$)/i.test(p) || /\/route\.(ts|js)$/.test(p),
    nearby: {
      pattern: /\b(zod|z\.object|yup|joi|valibot|superstruct|pydantic|BaseModel|schema\.parse|safeParse|validate\()/i,
      before: 25,
      after: 25,
      mustExist: false,
    },
    maxMatches: 25,
    cwe: 'CWE-20',
    rootCauseId: 'missing-input-validation',
    effortMinutes: 25,
    summary: (ctx) =>
      `\`${ctx.match.file.path}\` reads request input at line ${ctx.match.line} and no schema validation appears within 25 lines.`,
    impact:
      'Unvalidated input is the raw material for every injection class, and it turns type assumptions into runtime crashes when a field is missing or the wrong shape.',
    recommendation:
      'Define a schema per endpoint and parse at the boundary, so every line after the parse works with a known shape.',
    references: [],
  },
];
