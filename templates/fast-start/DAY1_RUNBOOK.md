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

## 2. Migration tool — in-band only (MIG-1, MIG-2)

Pick the migration tool (Drizzle / Alembic / Prisma) and commit to one rule from line 1:

- [ ] **Every schema change is a migration revision, applied via the tool — never raw
      `psql`/`ALTER` straight to prod (MIG-1).** Out-of-band changes diverge the DB head
      from the migration head and break `upgrade head` permanently.
- [ ] **The migration ships in the *same commit* as the code that references the new
      table/column (MIG-2).** Verify locally with a clean-DB `migrate head` before deploy.
- [ ] Add to the migration review checklist: any **NOT NULL column without a DEFAULT**
      requires grepping every `INSERT INTO <table>` and patching each, or adding a DEFAULT
      (MIG-3).
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

## 6. Minimum observability — before the first user (PROC-3)

Observability built *after* the incident it would have caught is excellent-but-too-late.
Ship the floor now:

- [ ] **Latency** per hot-path call (the gate above is the test; emit the metric in prod too).
- [ ] **Error rate** — structured error logs with a code field; an alert on rate spike.
- [ ] **Cost per call** if there's an LLM/external API in the path.

These three are the minimum that turns a silent degradation into a page.

---

## 7. The QA gate & the audit ledger (QA-1, QA-5)

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
      tests in step 8 are the *unit* seam net; this harness is the *scenario* net on top.

---

## 8. Copy the contract scaffold (SEAM-1/2/3, AGENT-I)

- [ ] Copy `scaffold/contract/*.ts` into your `contract/` (or `lib/contract/`) dir and edit
      the canonical ids/aliases for your domain.
- [ ] Copy `scaffold/tests/*.test.ts` into your test dir. The **property tests**
      (totality/surjectivity/idempotency/round-trip) should pass *before feature #1*.
- [ ] Fill in the INV-2 contract matrix in `ARCHITECTURE_INVARIANTS.md` with your first
      write entry point and its round-trip test.

---

## 9. Copy the critical-gap-audit skill (recurring detection)

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
- The property + contract scaffold tests pass.
- `docs/audits/INDEX.md` has a day-1 baseline row.
- `CLAUDE.md`, `ARCHITECTURE_INVARIANTS.md`, `QA_GATE_CHECKLIST.md` are committed.
