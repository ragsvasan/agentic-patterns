# fast-start — day-1 project template

The structure a brand-new project adopts on **day 1** so that a stable architecture and a
real QA gate are **built in, not bolted on later**. Every file here operationalizes a
gap class from [`docs/STABILITY_GAP_TAXONOMY.md`](../../docs/STABILITY_GAP_TAXONOMY.md) —
the distilled list of failure modes that cost real deploy cycles on Stryde and Mnemo.

The taxonomy's meta-pattern: *a local check passed while a downstream invariant was
already broken.* This template makes those invariants **structural** — enforced by the
compiler, a test, or a CI gate — so they can't silently rot.

---

## What's here

**Part 1 — Docs & checklists (stack-agnostic).** Copy, then edit for your domain.

| File | Establishes | Gap classes prevented |
|------|-------------|----------------------|
| `CLAUDE.md.template` | Project instructions: write-time defaults + the QA gate cycle | FAIL-1, BOUNDARY-1/2/3/4/7, PERF-2, RESIL-1/3/4, DIST-1, QA-1/2/6/7, AGENT-* |
| `ARCHITECTURE_INVARIANTS.md` | Structural invariants to fix **before** writing features | SEAM-1/2/3/4, BOUNDARY-5/7, RESIL-1/2/3/4, DIST-1/2/3, AGENT-T/K/A/P/I |
| `QA_GATE_CHECKLIST.md` | The gate: panel-before-commit, tests-as-deliverable, measurement honesty | QA-1/2/3/4/5/6/7 |
| `DAY1_RUNBOOK.md` | Ordered setup steps (repo, migrations, CI, resilience, latency gate, observability) | MIG-1/2/4/5, PERF-1, RESIL-1/2, DIST-1, PROC-3 |

**Part 2 — Runnable scaffold (`scaffold/`, opinionated TS/Next + Postgres).** Files use
`.template`/`.example` suffixes so they're **copy-then-edit**, not imported as-is.

| File | Establishes | Gap classes prevented |
|------|-------------|----------------------|
| `scaffold/contract/canonical-ids.ts` | Canonical-id + alias-map + `isCanonical` guard | SEAM-1, SEAM-3, AGENT-A |
| `scaffold/contract/boundary.ts` | Zod dispatch-boundary normalizer | SEAM-1, BOUNDARY-1 |
| `scaffold/contract/idempotency.ts` | Idempotency-key helper + unique-constraint note | AGENT-I |
| `scaffold/tests/contract.example.test.ts` | Write→read round-trip + seam-registry idea | SEAM-2 |
| `scaffold/tests/property.example.test.ts` | Totality / surjectivity / idempotency / round-trip | SEAM-3 |
| `scaffold/tests/metamorphic.example.test.ts` | Metamorphic relations + boundary fuzzing for non-deterministic output | QA-7 |
| `scaffold/resilience/circuit-breaker.example.ts` | Circuit breaker (open/half-open/closed) + bulkhead note | RESIL-1, RESIL-2 |
| `scaffold/resilience/adaptive-throttle.example.ts` | SRE adaptive client throttle + backoff with jitter | RESIL-3, RESIL-4 |
| `scaffold/distributed/transactional-outbox.sql` | Outbox table + partial unprocessed index | DIST-1 |
| `scaffold/distributed/outbox-publisher.example.ts` | Atomic entity+event write, at-least-once poller, idempotent consumer | DIST-1, DIST-3, DIST-2 (note) |
| `scaffold/ci/ci.yml.template` | GitHub Actions: concurrency + path filters + test + mutation job | PERF-1 (gate slot), QA-6, PROC-3 |
| `scaffold/ci/latency-gate.example.ts` | Hot-path latency gate (avg<500ms / p95<1000ms) | PERF-1 |

---

## Day-1 adoption order

Do these in order. Each step is cheap now and expensive to retrofit (that's the whole
point of the taxonomy).

1. **Read the taxonomy.** [`STABILITY_GAP_TAXONOMY.md`](../../docs/STABILITY_GAP_TAXONOMY.md).
   You can't prevent gaps you can't name.
2. **Copy `CLAUDE.md.template` → your repo's `CLAUDE.md`.** Fill in the stack line. This
   is what makes every future code-review and implementation task apply the write-time
   defaults and the QA gate automatically.
3. **Copy `ARCHITECTURE_INVARIANTS.md` into the repo and fill in the contract matrix.**
   Establish the single normalization boundary and the writer→reader matrix *before* the
   first feature. SEAM-* gaps are nearly impossible to retrofit once writes are scattered.
4. **Copy `QA_GATE_CHECKLIST.md`.** Wire the panel-before-commit cycle now so it's never
   "we'll add review later" (QA-1).
5. **Run `DAY1_RUNBOOK.md` top to bottom.** Repo init, migrations in-band only, CI with
   concurrency + path filters, latency gate, prod-schema-snapshot test DB, minimum
   observability, and copy the critical-gap-audit skill into `.claude/skills/`.
6. **Copy `scaffold/` files** into the matching paths and edit for your domain. The
   property, contract, and metamorphic tests should pass before you write feature #1. If the
   service is horizontally scaled, calls an external dependency on a request path, or writes
   to more than one store, also wire the `resilience/` (RESIL-*) and `distributed/` (DIST-*)
   scaffold — these are nearly impossible to retrofit once the dual-write / unbounded-retry
   paths are scattered.

---

## Relationship to the rest of `agentic-patterns/`

This template is the **prevention** side. The companion pieces:

- [`STABILITY_GAP_TAXONOMY.md`](../../docs/STABILITY_GAP_TAXONOMY.md) — the gap list
  (source of truth; cited inline throughout this template by ID).
- [`UNIVERSAL_FIX_PATTERNS.md`](../../docs/UNIVERSAL_FIX_PATTERNS.md) — canonical
  response-envelope / structured-error / user-content-wrapper helpers. Reference these
  rather than reinventing tool-response shapes; this template assumes them.
- `critical-gap-audit` skill — the **detection** side for *existing* projects. fast-start
  ships the day-1 prevention; the audit skill probes a live codebase for the same classes.

Reuse over duplication: where this template needs a tool-response or error shape, it
points at `UNIVERSAL_FIX_PATTERNS.md` instead of copying it.
