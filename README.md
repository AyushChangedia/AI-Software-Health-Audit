<div align="center">

# Sentinel

**Your AI engineering team for every codebase.**

Paste a GitHub repository. Nine specialised agents read it alongside
deterministic security tooling, argue with each other about what they find,
and return a report where every claim names a file, a line and a confidence.

</div>

---

## What it actually does

```
GitHub URL
    ↓  in-memory ingestion, nothing written to disk, nothing executed
Indexing            module graph · structural metrics · dependency manifests
    ↓
Eight agents        security · reliability · architecture · testing
in parallel         dependencies · performance · AI-code · maintainability
    ↓
Aggregation         findings describing the same issue are merged, and
                    corroboration raises confidence instead of the count
    ↓
Validator           looks for reasons each finding is wrong, and records
                    the exchange as a debate transcript
    ↓
Report              score · root causes · ordered plan · architecture map
                    · SARIF
```

Deterministic first, AI second. Static analysis finds what is provably there;
a model is good at judging whether it matters. **With no AI provider
configured Sentinel still runs a real analysis** — the agents fall back to
their static paths, and the report's "What ran" panel says exactly which
analyzers produced the findings and which were unavailable.

## Quick start

```bash
npm install
npm run dev
```

Open <http://localhost:3000>. No database, no API key, no Redis. Paste a
public repository, or run the bundled demo.

### Audit from the command line

```bash
npm run audit -- .                              # this checkout
npm run audit -- . --sarif out.sarif            # for code scanning
npm run audit -- . --fail-on critical           # exit 1 on a critical finding
```

The CLI runs the exact same pipeline as the web product — same rules, same
validator, same score — so a green CI run and a green report mean the same
thing. `.github/workflows/sentinel.yml` is Sentinel auditing itself and
publishing to GitHub code scanning; copy it into your own repository.

## What makes a finding

Every finding answers five questions, and refuses to be reported without
them:

| | |
| --- | --- |
| **What** | A concrete statement about a specific line |
| **Why it matters** | The consequence, not a severity label |
| **Evidence** | What the analyzer saw, including what argued *against* it |
| **Impact path** | Where the control breaks down, step by step |
| **How to fix it** | Specific to this code, with a patch where one can be generated safely |

Plus a confidence and a validation status — `confirmed`, `likely`,
`potential` or `dismissed` — and the debate that produced them.

### The validator

The validator's job is not to agree. It looks for the reason each finding is
wrong and downgrades it when it holds:

- Is this file reachable from any entry point?
- Does a mitigating control exist — parameter binding, a host allow-list, a
  sanitiser?
- Is the package actually imported, or just declared?
- Is this test-only code that never handles live input?

Findings that survive carry a higher confidence. Findings that do not are
kept in the report, marked dismissed, so you can see what was ruled out and
disagree.

## Analyzers

| Analyzer | What it does |
| --- | --- |
| **Secret scanner** | Vendor-format patterns plus a Shannon-entropy pass; placeholder-aware, so `AKIAIOSFODNN7EXAMPLE` is not reported as a live key |
| **Pattern rules** | ~40 rules across injection, configuration, reliability, performance and integration quality, with multi-line matching for calls that wrap |
| **Module graph** | Import resolution, cycle detection (Tarjan), reachability, dead exports, layering violations |
| **Structural metrics** | Cyclomatic-style complexity, nesting depth, function length, cross-file duplication fingerprinting |
| **Dependency advisories** | Live OSV.dev lookup, with a bundled snapshot so the analysis still works offline |
| **AI reasoning** | Optional. Enriches findings the static pass already located, and adjudicates the validator's hardest calls |

### AI code quality

Sentinel does **not** claim to detect AI-generated code — no tool can do that
reliably, and pretending otherwise would undermine everything else in the
report. What this agent measures is a cluster of patterns that appear when
code is produced faster than it is integrated: imports that resolve to
nothing, duplicated blocks, placeholder implementations, exports nobody
consumes. Every string it emits says *pattern*, never *generated*.

## The score

```
Security 25% · Reliability 15% · Architecture 15% · Testing 10%
Dependencies 10% · Performance 10% · Maintainability 10% · AI code 5%
```

Each category starts at 100 and loses points per finding, weighted by
severity **and** by how confident the validator was — a dismissed finding
costs nothing. Two properties matter:

- **Per-tier ceilings.** No number of low-severity findings can outweigh one
  authentication bypass. Critical and high are uncapped.
- **Damped totals.** Past a threshold, further deductions have square-root
  effect, so a large codebase still distinguishes "bad" from "catastrophic".

It is Sentinel's own model, not an industry standard, and the interface says
so wherever the number appears. The weights are configurable.

## Suppressions

Static analysis is only usable if you can tell it about your fixtures. Two
mechanisms, both conventional:

```gitignore
# .sentinelignore — gitignore-style globs, optionally scoped to rules
tests/fixtures/**
src/demo/*.ts          sec.secret.*
!tests/fixtures/real-config.ts
```

```ts
// sentinel-disable-next-line sec.sql-injection
await db.query(`SELECT * FROM ${table}`);
```

Suppressed findings are **counted and reported**, never silently dropped. A
report that hides how much it was told to ignore is not an honest report.

## Deployment

Everything is optional; `GET /api/health` reports what is on.

| Variable | Unset | Set |
| --- | --- | --- |
| `DATABASE_URL` | In-process store, mirrored to `.sentinel/` in dev | PostgreSQL (`npm i pg`; schema in `db/migrations`, model in `prisma/schema.prisma`) |
| `REDIS_URL` | Scans run in the web process | Dispatched to `npm run worker` (`npm i bullmq ioredis`) |
| `AI_PROVIDER` + `AI_API_KEY` + `AI_MODEL` | Deterministic analysis only | Model enrichment and validator adjudication |
| `GITHUB_TOKEN` | 60 API requests/hour | 5,000/hour |
| `SENTINEL_SECRET` | Sessions reset on restart | Sessions persist |
| `SENTINEL_DEMO_ONLY` | Live repositories allowed | Demo only — useful for a public instance |

See `.env.example` for the full list, and **[SECURITY.md](./SECURITY.md)** for
the threat model. Read that one before deploying this publicly.

## Architecture

```
src/
  agents/          one module per agent, all behind a single interface
    orchestrator/  ingests, wires the pipeline to the event stream, persists
    validator/     challenges findings and records the debate
  lib/
    analysis/      pipeline · index · rules · graph · metrics · scoring · roadmap
    security/      secrets · dependency advisories
    ai/            provider abstraction (Anthropic / OpenAI / Google / compatible)
    db/            Store port with in-process and PostgreSQL adapters
    events/        sequenced event log behind SSE
    queue/         in-process and Redis drivers
  app/             routes, API, pages
  components/      landing · scan · report · charts · ui
scripts/audit.ts   CLI over the same pipeline
```

Adding an agent means implementing one interface and adding it to the
registry. Adding a rule means adding an object to a table. Neither touches
the orchestrator.

### Real-time

Progress is a sequenced, durable event log streamed over SSE. A client that
reconnects sends `Last-Event-ID` and replays from where it left off, so a
dropped connection loses nothing — and a client that connects mid-scan gets
the whole run, including events still buffered in memory. There is a polling
fallback for environments that buffer streams.

## Development

```bash
npm run dev         # development server
npm run verify      # typecheck + lint + test + build
npm test            # 176 tests
npm run audit -- .  # audit this repository
```

Tests cover URL parsing, archive safety against hostile inputs, secret
detection and redaction, deduplication and confidence combination, the
scoring model, suppressions, the live-stream reducer, API route handlers,
SARIF export and an end-to-end scan of the bundled sample repository.

## Demo mode

The bundled sample repository (`acme-commerce`) is a real, small TypeScript
codebase with deliberate defects, and **the demo runs the same pipeline over
it** rather than replaying canned results. Every finding, score, root cause
and architecture node in demo mode is derived, which is the only way the demo
stays consistent as the engine changes. It is labelled `DEMO DATA` everywhere
it appears.

## A note on what this is

Sentinel is an analysis aid, not a substitute for a security review. It will
never tell you your code is safe — when nothing turns up, it says *no
high-confidence vulnerabilities were identified by the current analysis*,
because that is a different statement and the difference matters.

## Licence

MIT.
