# Stability Gaps — Self-Found Baseline

> This document records what we believe we've identified and covered, before external review.
> Its purpose: when Gemini's findings arrive, compare them here to distinguish
> (a) genuine novel gaps we missed vs. (b) things we already knew and addressed.
>
> **Date:** 2026-06-29
> **Source:** Distilled from Stryde/Mnemo incident history, 2026-05 through 2026-06.

---

## Confirmed gaps — found in production, fixed, and documented

Each entry lists: **the incident**, **the gap class it revealed**, and **where the fix lives**.

### Theme A — Seam Integrity

**SEAM-1 (canonical drift)**
- Incident: `activityType: 'other'` written by the coach for swimming/rowing; `log_workout` expected `'swimming'`/`'rowing'` canonical strings. Coach faithfully reported "swimming" but data stored as "other" silently.
- Found: June 2026 audit, L3 in STABILITY_ARCHITECTURE.md
- Fix: `normalizeType()` at every write boundary; `manifest.ts` enum expanded.

**SEAM-2 (no writer→reader test)**
- Incident: `capture_baseline` wrote biomechanics fields; `compare_to_baseline` read different fields. No round-trip test existed, so the drift was invisible until an audit called both tools in sequence.
- Found: June 2026 audit, L8 in STABILITY_ARCHITECTURE.md
- Fix: seam contract matrix + `contract.example.test.ts` scaffold.

**SEAM-3 (enum not exhaustive)**
- Incident: New `activityType` variants added to `log_workout` without updating every `switch`/match in the read path (ETM computation, HR zone calculator, dedup logic). New values silently fell through to `default` branches that returned `null` or `0`.
- Found: Phase B biomechanics work, June 2026
- Fix: `never` exhaustion guard in TypeScript; property test for totality.

**SEAM-4 (wrong entry point fixed)**
- Incident: Workout dedup bug fixed in one of three dedup implementations; other two had the same same-day strength silent-loss bug. The fix shipped; the bug persisted on two paths.
- Found: June 2026 (project_workout_dedup_paths memory)
- Fix: bodyPartScope + optional start_time + 60s BUFFER — applied across all three paths.

**SEAM-5 (cross-table unit mismatch)**
- Incident: ACWR computed as `acute_load / chronic_load` where acute and chronic used different time-window normalizations (7-day rolling vs. 28-day rolling, not divided by 7). Ratio was numerically plausible but wrong.
- Found: June 2026 audit E2
- Fix: unit assertion in ETM + golden-value regression test.

---

### Theme B — Failure Honesty

**FAIL-1 (silent exception swallow)**
- Incident: `resolve_pain_signal` swallowed a DB error on pain history fetch; returned `{ cleared: true }` to the coach. Coach advised "no contraindications" on corrupt data.
- Found: June 2026 T1 panel
- Fix: re-throw on DB error; fail-closed with `SAFETY_GATE_TRIPPED` response.

**FAIL-2 (JSON fallback on DB failure)**
- Incident: Readiness score computation fell back to a stale JSON cache when the DB was under load; coach used 3-day-old recovery scores as current without any staleness warning in the response.
- Found: June 2026 audit L2
- Fix: `dataFreshnessTtlSeconds` field on every read-tool response; coach system prompt checks it.

**FAIL-3 (loose mock hid signature drift)**
- Incident: `coachPolicy.ts` exported a new function; three `vi.mock()` files were not updated. Tests passed (bare mock accepted any call); production threw on the unrecognized export.
- Found: June 2026, `project_coachpolicy_mock_siblings` memory
- Fix: typed mock doubles; explicit export list in each mock file.

**FAIL-4 (timeout-free background async)**
- Incident: `asyncio.create_task(cache_warm())` in Mnemo MCP server ran without a stored reference and without `asyncio.wait_for`. On connection churn, the task was garbage-collected mid-run, silently leaving the cache cold.
- Found: Mnemo engineering, May 2026 (LESSONS-LEARNED.md §14)
- Fix: always store `task = asyncio.create_task(...)`; wrap with `asyncio.wait_for(task, timeout=30)`.

**FAIL-5 (fix without regression test first)**
- Incident: Pain gate clearance bug (audit C4) fixed without writing the regression test first. The same bug class (fail-open on empty location) re-appeared six weeks later in a different gate.
- Found: June 2026 T1 adversary panel
- Fix: `QA_GATE_CHECKLIST.md` QA-2 rule: regression test before fix, entering at the public entry point.

---

### Theme C — Migration & Schema

**MIG-1 (out-of-band schema change)**
- Incident: Drizzle migration journal diverged from prod schema after a `drizzle-kit push` was aborted mid-run by TTY (matview refresh triggered an interactive prompt in CI). Journal at revision 0048; prod at a different state. `upgrade head` silently no-op'd.
- Found: June 2026 (project_migration_pipeline_broken memory)
- Fix: journal resync (project_migration_journal_resync); mandatory `psql` migration loop in CI; no `drizzle-kit push` in prod.

**MIG-3 (NOT NULL without DEFAULT, INSERTs unpatched)**
- Incident: `password_changed_at NOT NULL` column added to `users` table via Alembic in Mnemo. Migration backfilled existing rows. Every `INSERT INTO users` in the backend omitted the new column → every new user signup failed for 4 days (commit f9fe5c10, Apr 26 2026).
- Found: Mnemo engineering (LESSONS-LEARNED.md §3); now in global CLAUDE.md as non-negotiable rule.
- Fix: grep all `INSERT INTO <table>` before committing any NOT NULL migration; checklist item in CLAUDE.md.

**MIG-4 (test DB not prod snapshot)**
- Incident: Integration tests ran against a clean DB seeded from ORM `createTable` calls. Prod had an extra partial index and two backfill columns that tests never saw. A constraint violation only appeared in prod on deploy.
- Found: June 2026 audit MIG-4 probe
- Fix: CI seeds from `pg_dump --schema-only`; no table creation at app startup.

---

### Theme D — Boundary Enforcement

**BOUNDARY-2 (auth after first DB read)**
- Incident: An MCP tool handler fetched `user.profile` before checking the bearer token. On token validation failure, the handler returned an error — but by then a DB read had already executed under the (potentially attacker-controlled) user ID.
- Found: June 2026 security panel
- Fix: `auth()` as the first statement in every handler; token verify hits in-memory cache only (PERF-3).

**BOUNDARY-3 (soft-delete not filtering)**
- Incident: `get_workout_history` did not filter `deleted_at IS NULL`. Deleted workouts appeared in load calculations and coach context.
- Found: June 2026 red-team (project_red_team_fix_plan memory)
- Fix: mandatory `deleted_at IS NULL` in every query on soft-deletable tables; seam probe added.

**BOUNDARY-4 (tenant column missing from write WHERE)**
- Incident: `update_watch_item` used `WHERE id = $1` without `AND user_id = $2`. Any authenticated user could modify another user's watch items via IDOR.
- Found: June 2026 SC run (project_sc_run_2026-06-02 memory); P0 finding
- Fix: tenant/owner column in every UPDATE/DELETE WHERE; security panel §IDOR check.

**BOUNDARY-6 (sanitizer not on all paths)**
- Incident: The prompt-injection scrubber (`ArmorMiddleware`) wrapped the main MCP endpoint but not the Apple Health ingest worker endpoint. Attacker-controlled health note text could inject tool calls via the ingest path.
- Found: June 2026 ingestion security hardening (CRIT-1)
- Fix: `user_content` fence on all external-data write paths; scrubber applied at the worker too.

---

### Theme E — Hot-Path Performance

**PERF-1 (blocking call in hot path)**
- Incident: A `GET /me` loopback was added to the per-request auth-verify path to refresh user profile. Added 12,291 ms to every tool call (measured). No latency gate existed to catch it before deploy.
- Found: June 2026 (LESSONS-LEARNED.md §11)
- Fix: latency gate CI job; in-memory TTL auth cache (PERF-3).

**PERF-3 (auth verify hits DB every call)**
- Incident: Token validation `pool.acquire()` on every MCP tool call; under connection pressure the pool queue backed up, serializing all concurrent tool calls.
- Found: June 2026 red-team (project_red_team_fix_plan memory): "10x latency"
- Fix: in-memory TTL cache for token verification; pool.acquire only on cache miss.

---

### Theme F — QA as a Gate

**QA-3 (ART counted as FAIL)**
- Incident: Coaching audit showed 74% failure rate. Root cause: rate-limit errors from the audit API key were classified as product failures. Real failure rate was ~5%.
- Found: June 2026 (project_audit_noise_rate_limit memory)
- Fix: VPASS/VFAIL/QUAL/ART/NA classification system; rate-limit keys exempt from limiting in audit mode.

**QA-4 (L2 seam defect misdiagnosed as L1 model failure)**
- Incident: Coach gave wrong modality advice for cycling. Diagnosed as "prompt needs updating." Real cause: `calculateReadinessScore` read `RECOVERY_SCORE` from the wrong column (L2 seam defect). Prompt change did nothing; the data was corrupt.
- Found: June 2026 audit L2, STABILITY_ARCHITECTURE.md
- Fix: L1/L2 triage protocol in QA_GATE_CHECKLIST.md; "can you reproduce by calling tools directly?" test.

**QA-5 (no regression baseline)**
- Incident: An audit run showed 45 passes. Was that good or bad? No prior run on record. A week later, 38 passes — regression or denominator change? Unknown.
- Found: June 2026 (project_coaching_audit_ledger memory)
- Fix: `docs/audits/INDEX.md` dated ledger with run → SHA → VPASS/VFAIL counts.

---

### Theme G — Agentic Governance (TKA)

**AGENT-T (Totem — no independent check on state write)**
- Incident: `log_freeform(category='user_plan')` returned `{ ok: true }` without committing a `weekly_plans` row. Coach believed it had saved a plan; athlete saw no plan in the UI.
- Found: June 2026 (project_plan_save_invariant memory)
- Fix: two-stage commit; `log_freeform(user_plan)` hard-errors `PLAN_PERSIST_REQUIRED`; `generate_plan` is the only plan-creating path.

**AGENT-I (idempotency missing)**
- Incident: `log_workout` called twice on network retry logged duplicate workouts. No idempotency key, no `ON CONFLICT` constraint.
- Found: June 2026 (project_idempotency_partial_index_drift memory)
- Fix: `idempotency_key` param on all write tools; `ON CONFLICT DO UPDATE SET updated_at = NOW()` with unique constraint. Partial-index drift from Drizzle required explicit `targetWhere`.

**AGENT-A (Architect — model introduces unknown category)**
- Incident: The coach logged `activityType: 'triathlon'` for a triathlon session. The persistence layer had no such enum value; it silently stored `null` (Postgres enum cast failure masked by ORM).
- Found: June 2026 seam audit
- Fix: closed enum in schema + input validation at the MCP boundary; Zod enum parse before any DB write.

---

## Gaps we have NOT yet verified

These were identified as potential gaps but not confirmed with production incidents:

| Gap | Status | Note |
|-----|--------|------|
| Distributed dual-write / transactional outbox | Not addressed | May belong as Theme I — waiting for Gemini |
| Supply-chain / SBOM integrity | Partial (PROC-2) | Covered as advisory; not a first-class probe |
| Circuit breaker / bulkhead (Nygard ch.4-5) | Not addressed | PERF-* covers latency but not cascading failure |
| Canary / progressive delivery gating | Not addressed | Deployments are manual (PROC-6); no automated rollback |
| Secret rotation during live traffic | Not addressed | Managed via Secret Manager; rotation runbook absent |
| Saga / compensation for multi-table writes | Not addressed | Relevant: plan save touches 3 tables; no compensation on partial failure |

---

## Self-assessment confidence

| Theme | Confidence in coverage | Notes |
|-------|----------------------|-------|
| SEAM | High | 5 incidents, 5 fixes, all verified |
| FAIL | High | 5 incidents across Mnemo + Stryde |
| MIG | High | 2 severe incidents; MIG-2 observed but not a named production incident |
| BOUNDARY | High | 4 incidents; BOUNDARY-5 is advisory-only |
| PERF | Medium | 2 incidents; Nygard stability patterns (circuit breaker, bulkhead) not represented |
| QA | High | 3 incidents, all verified in audit history |
| AGENT | Medium-high | 3 incidents; AGENT-K (Kick / loop cap) observed but not a production incident |
| PROC | Low-medium | Structural observations; no single PROC incident drove the taxonomy |

---

*This is the self-assessment baseline. Gemini's H1–H6 findings should be compared against this table to identify what is genuinely novel vs. already known and addressed.*
