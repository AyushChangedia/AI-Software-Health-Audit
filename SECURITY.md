# Security model

Sentinel reads code it did not write, on behalf of people it does not know.
That makes every repository it touches untrusted input, and the design starts
from that assumption rather than adding controls to it afterwards.

This document is what a reviewer should read before deploying it.

## Threat model

Three things are attacker-controlled:

1. **The repository URL.** Anyone can submit one.
2. **The repository contents.** File paths, source text, dependency manifests
   and archive structure are all chosen by whoever owns the repository.
3. **The rendered output.** Findings quote source, and that source ends up in
   a browser.

The assets worth protecting are the host filesystem and network, the API keys
in the environment, other users' scan data, and the browser session of anyone
viewing a report.

## Repository contents are never written to disk or executed

The archive is fetched over HTTPS, decompressed in memory, and walked in
memory. Sentinel never:

- writes repository files to disk,
- shells out to `git`, a package manager, a build tool or a test runner,
- installs dependencies,
- `eval`s, imports or otherwise runs anything it reads.

Analysis is pure text and graph processing over the in-memory index. There is
no sandbox to escape because nothing is executed in the first place.

The CLI (`npm run audit`) reads a directory already on disk — in CI, the
checkout. It reads only; the same "never execute" rule applies.

## Archive handling

`src/lib/analysis/tar.ts` is a purpose-built reader rather than a general tar
library, because the general case includes entry types Sentinel should never
materialise. It refuses:

| Attack | Control |
| --- | --- |
| Path traversal (`../../etc/passwd`) | Every entry path is validated; `..`, absolute and drive-letter paths are dropped |
| Symlink / hardlink escape | Entry types `1` and `2` are skipped, never followed |
| Device nodes, FIFOs, setuid bits | Only regular files (`0`) are read at all |
| Decompression bomb | `gunzip` runs with `maxOutputLength`; exceeding it aborts the scan |
| Memory exhaustion by file count | `SCAN_MAX_FILES` cap, with truncation reported in the metrics |
| Memory exhaustion by file size | `SCAN_MAX_FILE_BYTES` per file, `SCAN_MAX_TOTAL_BYTES` overall |
| Lying `Content-Length` | The download is streamed and counted; the cap is enforced against bytes received |

These are covered by tests in `tests/ingest-safety.test.ts`, which construct
hostile archives directly.

## Server-side request forgery

The repository URL is attacker-controlled, so it must never become an
arbitrary fetch target. Two hosts are hard-coded — `api.github.com` and
`codeload.github.com` — and the owner and repository name are validated
against GitHub's own character rules before being URL-encoded into a path.
There is no configuration that points the fetcher somewhere else.

## Secrets found during a scan

The scanner exists to find committed credentials, which means it handles them.

- Matched values are masked (`ghp_abcd…wxyz`) before they enter a finding.
- After aggregation, a repository-wide redaction pass masks **every** matched
  value across **every** finding, because a snippet rendered for one finding
  can contain a neighbouring secret from the same file.
- Redaction covers summaries, impacts, recommendations, all code snippets
  including secondary locations, evidence, data-flow steps and patches.
- The structured logger masks credential-shaped strings independently, so a
  value cannot reach a log line either.

`tests/secrets.test.ts` and `tests/orchestrator.test.ts` both assert that no
raw secret from the sample repository survives into the report.

## Rendering untrusted source

Code is tokenised into an array and rendered as React children — never as
HTML, never through `dangerouslySetInnerHTML`. There is no path by which
repository content becomes markup.

A Content Security Policy is set on every response (`next.config.ts`) along
with `X-Content-Type-Options`, `X-Frame-Options: DENY`, a restrictive
`Permissions-Policy` and `frame-ancestors 'none'`.

## Sessions and access control

Auditing a public repository needs no account. Scans still have to belong to
someone, so each visitor gets an opaque workspace id in an `HttpOnly`,
`SameSite=Lax`, `Secure`-in-production cookie, signed with HMAC-SHA256 using
`SENTINEL_SECRET`. The cookie carries no personal data and grants no
privileges — it is a namespace key, signed so that one visitor cannot read
another's scans by guessing an id.

A scan is readable by its own workspace, or by anyone holding its unguessable
share id if the author opted in to sharing. Reports for private repositories
are never given a share id.

## Request hardening

- **Origin checking** on state-changing routes, in addition to `SameSite=Lax`.
- **Rate limiting** per IP on scan creation (`RATE_LIMIT_SCANS_PER_HOUR`).
  In-process by default; move it to a shared counter when you run more than
  one instance.
- **Schema validation** on every request body, with errors that explain the
  problem rather than echoing input.
- **No stack traces** cross the API boundary. Failures return a typed error
  with a user-facing message and a recovery hint; the detail goes to the log.

## Process isolation

By default scans run in the web process with bounded concurrency. That is
sound because nothing from the repository is executed — but it does mean a
pathological repository competes for the same event loop as requests.

For a public deployment, set `REDIS_URL` and run `npm run worker`. Analysis
then happens in a separate process that can be given its own resource limits,
its own network policy, and none of the web tier's credentials.

## What Sentinel does not do

- It does not write to your repository. Patches are generated for you to read
  and apply; the GitHub write actions are disabled unless explicitly
  configured, and they are never automatic.
- It does not install or run your dependencies, so it cannot be compromised by
  a malicious postinstall script.
- It does not send repository source to an AI provider unless one is
  configured. When one is, only the specific snippets a deterministic detector
  already flagged are sent — never the whole repository.

## Reporting a vulnerability

Open a private security advisory on the repository rather than a public issue.
Please include the repository or input that triggers it; a scan of a public
repository is usually enough to reproduce.
