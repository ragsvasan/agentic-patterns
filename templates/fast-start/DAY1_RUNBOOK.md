# Day-1 Runbook — concrete setup steps

> Copy into your repo and run top to bottom on the day you start the project. Each step
> installs the prevention for a gap class from `STABILITY_GAP_TAXONOMY.md` (cited inline) as
> **structure**, before any feature code makes it expensive to add. Stack-specific commands
> assume TS/Next + Postgres; adapt the equivalents for your stack.

---

## 1. Initialize the repo

```bash
git init
# main is the default; protect it — fix-attempts go on feature branches (PROC-6)
```

- [ ] Copy `CLAUDE.md.template` → `CLAUDE.md`; fill in the stack line.
- [ ] Copy `ARCHITECTURE_INVARIANTS.md` and `QA_GATE_CHECKLIST.md` into the repo root.
- [ ] Add `.testmondata`, `.env.local`, and any local-state files to `.gitignore`.

---

## 2. Migration tool — in-band only (MIG-1, MIG-2, MIG-5)

Pick the migration tool (Drizzle / Alembic / Prisma) and commit to one rule from line 1:

- [ ] **Every schema change is a migration revision, applied via the tool — never raw
      `psql`/`ALTER` straight to prod (MIG-1).** Out-of-band changes diverge the DB head
      from the migration head and break `upgrade head` permanently.
- [ ] **The migration ships in the *same commit* as the code that references the new
      table/column (MIG-2).** Verify locally with a clean-DB `migrate head` before deploy.
- [ ] Add to the migration review checklist: any **NOT NULL column without a DEFAULT**
      requires grepping every `INSERT INTO <table>` and patching each, or adding a DEFAULT
      (MIG-3).
- [ ] **Under a rolling deploy (Cloud Run / k8s), use expand/contract — never a destructive
      migration in one shot (MIG-5).** Old and new containers serve traffic concurrently; a
      migration that adds a `NOT NULL`-without-default, renames, drops, or type-narrows in a
      single revision crashes the still-running old container the instant it applies. "Same
      commit" (MIG-2) does not save you — the schema and new code are atomic to each other but
      not to the *old code still in the pool*. Split into three safe steps:
      **Expand** (ship an additive-only migration + code that writes both shapes, reads old) →
      **Migrate** (backfill existing rows in the background) → **Contract** (ship code that
      reads/writes only the new shape; *after* old containers retire, a final migration adds the
      `NOT NULL` / drops the legacy column). Each step is safe against a concurrent old container
      and against rollback.
- [ ] (Alembic) After adding a revision: `grep -rh "^revision = " alembic/versions/ | sort |
      uniq -d` must be empty; `alembic heads` must be warning-free.

---

## 3. Prod-schema-snapshot test DB (MIG-4)

Don't test against a clean DB — test against the surface that will actually fail in prod.

- [ ] CI spins up Postgres and seeds it from a **schema snapshot of prod** (or of `migrate
      head` if prod doesn't exist yet):
      ```bash
      pg_dump --schema-only "$PROD_DATABASE_URL" > db/schema-snapshot.sql
      # CI: psql "$TEST_DATABASE_URL" < db/schema-snapshot.sql before running tests
      ```
- [ ] **No tables created at app startup.** Any table created outside migrations (in app
      boot code) exists in prod but not in a clean test DB — MIG-4's exact failure. Every
      table is a migration.

---

## 4. CI — concurrency + path filters + tests (PROC-3, plus standing rules)

- [ ] Copy `scaffold/ci/ci.yml.template` → `.github/workflows/ci.yml`. It already includes
      the two mandatory blocks:
      - **Concurrency** (`cancel-in-progress: true`) — cancels stale runs on rapid pushes.
      - **Push `paths-ignore`** for `**.md` and config-only files — skip CI for docs.
- [ ] The test job runs against the prod-schema-snapshot DB from step 3.
- [ ] Never trigger the same workflow on both `push` and `pull_request` to the same branch
      without concurrency.

---

## 5. Latency gate on the hot path (PERF-1)

A single blocking call dropped into a per-request path is a latency cliff for *every* call
(Mnemo: one `GET /me` loopback added 12,291 ms to every tool call; no gate caught it).

- [ ] Copy `scaffold/ci/latency-gate.example.ts`; point it at your hot path (auth verify,
      tool dispatch, the per-request critical path).
- [ ] It runs in <30 s locally and asserts **avg < 500 ms / p95 < 1000 ms**.
- [ ] Wire it into CI as a job on any commit touching the protocol/auth hot path.

---

## 6. Resilience & distributed correctness — if the shape applies (RESIL-*, DIST-*)

> Skip the sub-bullets that don't fit: RESIL-* only if the service is horizontally autoscaled,
> fronts a shared datastore, calls an external dependency on a request path, or is driven by an
> LLM client that can retry. DIST-* only if one logical action writes to more than one store /
> service / external system.

- [ ] **Circuit breaker on every cross-process call (RESIL-1).** Copy
      `scaffold/resilience/circuit-breaker.example.ts`; wrap each downstream (DB, external API,
      a second MCP server) in its **own** breaker instance. A breaker fails fast while the peer
      is sick instead of letting the slowness propagate up and take down unrelated tools.
- [ ] **Bulkhead per dependency (RESIL-2).** A bounded concurrency pool/semaphore per external
      dependency class, so a slow peer exhausts only its own partition, not the shared core path.
- [ ] **Client-side adaptive throttle + backoff with jitter (RESIL-3).** Copy
      `scaffold/resilience/adaptive-throttle.example.ts` (Google SRE drop probability
      `max(0, (requests − K·accepts)/(requests + 1))`, `K=2`). Then compute
      `max_instances × pool_size` — it **must stay under Postgres `max_connections`**, or
      saturated autoscaling blacks out the DB.
- [ ] **Timeout budget on the synchronous tool path (RESIL-4).** Every foreground external call
      gets a deadline (`AbortSignal.timeout` / `asyncio.wait_for`); the end-to-end request budget
      is the sum of its hops' deadlines, enforced at the top of the path.
- [ ] **No raw dual write — use the transactional outbox (DIST-1).** If a handler writes the DB
      and then calls a second service/queue, copy `scaffold/distributed/transactional-outbox.sql`
      + `outbox-publisher.example.ts`: write the entity **and** an event row in one ACID
      transaction; a separate poller forwards at-least-once. Nothing is lost on partial failure.
- [ ] **Idempotent consumer (DIST-3).** Any event/queue/webhook consumer dedupes on the event id
      (unique constraint or idempotent `UPSERT`) — at-least-once delivery means every event can
      arrive twice. For a multi-service operation that can't share one transaction, use an
      orchestrated saga with compensating transactions (DIST-2), but first try to collapse the
      writes into one ACID transaction.

---

## 7. Minimum observability — before the first user (PROC-3)

Observability built *after* the incident it would have caught is excellent-but-too-late.
Ship the floor now:

- [ ] **Latency** per hot-path call (the gate above is the test; emit the metric in prod too).
- [ ] **Error rate** — structured error logs with a code field; an alert on rate spike.
- [ ] **Cost per call** if there's an LLM/external API in the path.

These three are the minimum that turns a silent degradation into a page.

---

## 8. The QA gate & the audit ledger (QA-1, QA-5)

- [ ] Confirm `QA_GATE_CHECKLIST.md` is in the repo and the `CLAUDE.md` session-start
      pointer references it — so panel-before-commit is wired from the first PR (QA-1).
- [ ] Create `docs/audits/INDEX.md` as the dated regression ledger (QA-5). First entry is
      the day-1 baseline once the scaffold tests pass.
- [ ] **(Agentic / MCP / LLM-client projects only)** Wire the runnable scenario harness in
      `agentic-patterns/qa-framework/` (QARunner + tracer + scenario/probe types). It drives
      live tool calls against your server and emits **classified** results — the deterministic
      half of QA-3, and the L1/L2 split of QA-4. The `templates/*.template.ts`
      (`scenarios.template.ts`, `probes.template.ts`, `runner.entrypoint.template.ts`,
      `aliases.template.ts`) are the copy-then-edit entry points; `docs/QA_AGENT_DESIGN.md`
      and `docs/HEADLESS_COACH_QA_FRAMEWORK.md` are the design briefs. The contract/property
      tests in step 9 are the *unit* seam net; this harness is the *scenario* net on top.

---

## 9. Copy the contract scaffold (SEAM-1/2/3, AGENT-I)

- [ ] Copy `scaffold/contract/*.ts` into your `contract/` (or `lib/contract/`) dir and edit
      the canonical ids/aliases for your domain.
- [ ] Copy `scaffold/tests/*.test.ts` into your test dir. The **property tests**
      (totality/surjectivity/idempotency/round-trip) should pass *before feature #1*.
- [ ] For any **non-deterministic / model-backed** output, copy
      `scaffold/tests/metamorphic.example.test.ts` and write one **metamorphic relation** per
      quantity you can't pin to an exact oracle (more duration ⇒ strictly more calories), plus a
      **boundary fuzz** (fast-check / Hypothesis) at the untrusted input edge (QA-7).
- [ ] Fill in the INV-2 contract matrix in `ARCHITECTURE_INVARIANTS.md` with your first
      write entry point and its round-trip test.

---

## 10. Copy the critical-gap-audit skill (recurring detection)

- [ ] Copy the `critical-gap-audit` skill into `.claude/skills/` so any future session can
      run it to re-probe the live codebase against every gap class:
      ```bash
      mkdir -p .claude/skills
      cp <agentic-patterns>/skills/critical-gap-audit.md .claude/skills/
      ```
      > If the skill file isn't present in `agentic-patterns/skills/` yet, the
      > `STABILITY_GAP_TAXONOMY.md` "Probe" lines are the manual equivalent — each gap class
      > lists the grep/test that detects it. fast-start is the *prevention* side; the audit
      > skill is the *detection* side for ongoing drift.

---

## Done when

- `migrate head` on a clean DB matches the prod-schema snapshot.
- CI is green with concurrency + path filters + the latency gate.
- The property + contract + metamorphic scaffold tests pass.
- (If the shape applies) every cross-process call is behind a breaker + timeout (RESIL-1/4),
  and any dual write goes through the outbox, not a raw second-service call (DIST-1).
- `docs/audits/INDEX.md` has a day-1 baseline row.
- `CLAUDE.md`, `ARCHITECTURE_INVARIANTS.md`, `QA_GATE_CHECKLIST.md` are committed.
