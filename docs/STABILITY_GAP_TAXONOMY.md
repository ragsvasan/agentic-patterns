# Stability Gap Taxonomy

The gaps that bite production systems built with an LLM in the loop — distilled from
real incidents (Stryde headless coach, Mnemo). Each one cost deploy cycles, sprint
capacity, or a prod failure before it was named. This is the source-of-truth list that
the `critical-gap-audit` skill probes for and the `fast-start` template prevents from
day one.

**The meta-pattern behind almost all of them:** *a local check passed while a
downstream invariant was already broken.* The mock passed but the signature was wrong.
The clean-DB migration passed but prod had extra tables. The write succeeded as one type
string and the read queried a different one — they never met. Tests stay green; prod
silently rots.

The discipline that counters all of them: **trace the full path before declaring
anything done.** "It works here" scope is almost never the full scope.

---

## How to use this document

- **Auditing an existing project?** Run the `critical-gap-audit` skill. It walks every
  gap class below, runs the probe, and emits a PASS / FAIL / PARTIAL / N-A table.
- **Starting a new project?** Use the `fast-start` template. It ships the day-1
  prevention for each class as structure, not convention.
- **Reviewing a diff?** The gap classes map to panel checks. A diff that touches a
  write path is exercising SEAM-*, FAIL-*, and BOUNDARY-* whether the author noticed or not.

Each gap class is tagged with **Applies to** so you can skip classes that don't fit
(e.g. AGENT-* only fires for systems where an LLM/agent can write state).

---

## Theme A — Seam Integrity

*The single highest-yield class. A "seam" is any writer→reader contract: two pieces of
code that must agree on a type, shape, enum, unit, or state with nothing enforcing the
agreement. Every seam with no enforcement is a place a bug hides in plain sight, because
neither side looks wrong in isolation.*

**Applies to:** every project with a persistence layer or more than one module.

### SEAM-1 — Write-alias / read-canonical drift
- **Pattern:** data is written under one type string and read under another. Write
  succeeds, read succeeds, they never intersect. (Stryde: `hrv_rmssd` written, `HRV`
  read — the safety gate that depended on it silently never fired for any athlete.)
- **Day-1 prevention:** a single normalization boundary (Zod transform at the dispatch
  edge) that canonicalizes *before any business code runs*; the DB column branded with
  the canonical type so the compiler rejects raw strings downstream.
- **Probe:** grep for the type/enum being written vs. the strings being queried. Do they
  use the same canonical constant, or string literals on each side?

### SEAM-2 — The writer→reader contract matrix is not enumerated
- **Pattern:** nobody can answer "for this write tool, which read tools consume the data,
  and is there a test that proves the round-trip?" Gaps are invisible because no one has
  listed the paths. (Stryde: `log_subjective` wrote mood/soreness/RPE that *no read tool
  surfaced* — a data black hole for weeks.)
- **Day-1 prevention:** a contract matrix (every write tool → tables written → read tools
  that consume → contract test ID) maintained as code or doc. A new write tool is not
  done until its row exists and its round-trip test passes.
- **Probe:** is there a contract matrix / seam registry? For each write entry point, find
  the test that writes then reads back through a *different* tool and asserts the value
  survives.

### SEAM-3 — New enum / ID format / type added in one place, not all
- **Pattern:** a new variant is added to the writer but a downstream match/regex/branch
  doesn't handle it, so it falls through to a default and is silently dropped or
  mis-bucketed. (Stryde: 5 of 7 screenshot metric types stored as raw strings because the
  alias map had `VO2MAX` but not the `VO2_MAX` the normalizer actually produced.)
- **Day-1 prevention:** exhaustive `switch` with a `never` default; property tests for
  *totality* (every alias maps to a canonical) and *surjectivity* (every canonical is
  reachable from ≥1 alias). Adding a dead canonical fails the test.
- **Probe:** grep every match-statement / regex / conditional that branches on the
  enum. Does each handle the newest variant? Is there a totality test?

### SEAM-4 — Multiple entry points; the fix landed on the wrong one
- **Pattern:** the same logical operation has two implementations (server vs. client
  package, two dedup paths, two strength-logging paths). A bug is fixed in one; the path
  users actually hit is the other. (Mnemo: 404 fixed in the deployed backend; real bug
  was in the client pip package calling a stale route — a full deploy for nothing.)
- **Day-1 prevention:** when debugging a protocol/contract layer, grep the *caller* first
  and confirm the exact path it takes before touching any implementation. Collapse
  duplicate paths to one where possible.
- **Probe:** grep for sibling implementations of the same operation (e.g. dedup, log,
  normalize). Are there ≥2? Do they share a code path or drift independently?

### SEAM-5 — Cross-table numeric expression with unit/shape mismatch
- **Pattern:** a ratio/delta/percentage combines values from two tables that turn out to
  be in different units or populated by different paths, producing a number that is wrong
  but plausible. (Stryde: load math read sleep from one table, screenshots wrote it to
  another — readiness silently diverged by entry path.)
- **Day-1 prevention:** any expression combining two data sources gets a contract test
  with known inputs and an asserted output; document the unit on every column.
- **Probe:** find numeric expressions spanning two tables/sources. Is the unit asserted
  anywhere? Is there a golden-value test?

---

## Theme B — Failure Honesty

*Silent failure is the most expensive bug class because it delays diagnosis and corrupts
downstream state. The rule: fail loud, fail closed, never serve stale data as real.*

**Applies to:** every project.

### FAIL-1 — Silent exception swallowing near IO
- **Pattern:** a broad `except`/`catch` near a DB or network call absorbs an error it was
  never designed to catch (a wrong-kwarg `TypeError`, say), runs a fallback, and tests
  stay green while prod silently fails. (Mnemo: a wrong `ttl_days` kwarg was swallowed by
  `except (AttributeError, NotImplementedError)`; every OAuth token exchange failed for
  weeks.)
- **Day-1 prevention:** every `catch` re-throws, returns a typed error, or logs + returns
  a safe value. No bare `except Exception` / `catch (e: unknown)` without a re-throw or
  log. Narrow the catch to the exceptions you actually expect.
- **Probe:** grep `except`/`catch` blocks near IO. For each, ask: "would an unexpected
  error type reach this handler and be silently absorbed?"

### FAIL-2 — JSON / cache fallback on DB failure (silent stale data)
- **Pattern:** "try DB, on failure read/write a local JSON or in-memory cache." Creates a
  dual source of truth; the fallback hides the outage until it cascades. No alert fires.
- **Day-1 prevention:** on a DB failure for data that lives in the DB, *raise*. A visible
  error is cheaper than silently-served stale data.
- **Probe:** grep for file/JSON writes or cache reads inside DB-error handlers.

### FAIL-3 — Loose mocks let signature drift hide for months
- **Pattern:** a bare `MagicMock` / `jest.fn()` / `lambda` accepts any call signature, so
  a test exercises the error branch (or a fiction) instead of the real path. Green tests,
  shipped bug. (Mnemo: an invalid kwarg passed CI because the mock raised `AttributeError`
  and the test asserted on the *fallback*.)
- **Day-1 prevention:** `create_autospec(real_fn, ...)` (Python) / typed test doubles that
  enforce the real signature. Integration tests hit real DB/APIs where possible — no
  mock-only coverage of a write path.
- **Probe:** grep for bare `MagicMock(`, `jest.fn()` standing in for a typed dependency,
  `lambda` mocks. Are DB/external mocks signature-enforced?

### FAIL-4 — Timeout-free background async stalls forever
- **Pattern:** a fire-and-forget coroutine with no timeout. If it stalls (slow DB,
  network), an in-flight lock is never released and every subsequent request for that key
  hits the locked-out branch — for the life of the process. No alert. (Mnemo:
  `_background_prefetch` locked a profile permanently on a stalled brief fetch.)
- **Day-1 prevention:** every background/await that can stall gets `asyncio.wait_for` /
  `AbortSignal.timeout`. Store task references so they aren't GC'd.
- **Probe:** grep `create_task` / detached promises / background fetches. Does each have a
  timeout? Is the task reference stored?

### FAIL-5 — "Fixed" without a regression test written first
- **Pattern:** a fix is declared done after the symptom disappears, without a test that
  fails before and passes after. The same class re-surfaces two sessions later. Often the
  "fix" addressed one of several hops.
- **Day-1 prevention:** write the regression test (entry point → trigger → assertion)
  *before* the fix. If you can't write it, the fix isn't verified.
- **Probe:** for recent bug-fix commits, is there a paired `test_regression_*` /
  `*.regression.test` entering at the public entry point?

---

## Theme C — Migration & Schema Discipline

**Applies to:** every project with a relational schema and migrations.

### MIG-1 — Out-of-band schema change breaks the migration chain permanently
- **Pattern:** a schema change applied as raw SQL straight to prod, bypassing the
  migration tool. DB head diverges from migration head; `upgrade head` now fails across a
  multi-version gap and the workaround carries forward forever. (Mnemo: a dedicated sprint
  to reconcile ~20 versions of drift.)
- **Day-1 prevention:** never `psql` a schema change. Always migration-tool revision +
  upgrade. The 10 minutes saved is not worth the broken chain.
- **Probe:** does prod schema match `migrate head` on a clean DB? Any `stamp`/manual-sync
  notes in the migration history?

### MIG-2 — Code references a table/column with no migration in the same commit
- **Pattern:** code shipped referencing a new table/column; the migration is a "follow-up"
  that didn't land. Prod throws `UndefinedTable`/`UndefinedColumn` seconds after deploy.
- **Day-1 prevention:** the migration is part of the *same commit* as the code that needs
  it. Verify locally with `migrate head` before deploy.
- **Probe:** grep new table/column names in code; confirm a migration in the same change
  creates them.

### MIG-3 — NOT NULL column added without DEFAULT, INSERT sites unpatched
- **Pattern:** a migration backfills existing rows for a new NOT NULL column but leaves
  `INSERT` statements unpatched — so every *new* row creation breaks. (A real incident:
  `password_changed_at` broke every new signup for 4 days.)
- **Day-1 prevention:** for any NOT NULL column with no DEFAULT, grep every `INSERT INTO
  <table>` and confirm each includes the column — or add a DEFAULT.
- **Probe:** `grep -rn "INSERT INTO <table>"`; does each include every NOT NULL column?

### MIG-4 — Tests run against a clean DB, not a prod schema snapshot
- **Pattern:** runtime-created tables (made by app startup, not migrations) exist in prod
  but not in a clean test DB. The clean migration run passes; prod fails on the extra
  surface. (Mnemo: tables created in `db.py` at startup.)
- **Day-1 prevention:** seed the test DB from `pg_dump --schema-only` of prod. Test the
  exact surface that will fail.
- **Probe:** are any tables created outside migrations (at app startup)? Does CI test
  against a prod-shaped schema?

---

## Theme D — Boundary Enforcement

*Security and correctness invariants belong at the entry boundary, enforced by structure,
not re-checked deep in helpers where one caller will forget.*

**Applies to:** every project with auth, tenancy, or external input.

### BOUNDARY-1 — Validation isn't at the entry boundary
- **Pattern:** raw `data["key"]` / `body.foo` accessed without a schema parse at the
  handler; validation is scattered (or absent) deeper in. (Also: over-engineered the thing
  that didn't need it while under-validating the thing that did.)
- **Day-1 prevention:** Zod/Pydantic schema at every route/CLI/tool handler. The boundary
  owns the contract; helpers trust it.
- **Probe:** grep handlers for unparsed access to request bodies/params.

### BOUNDARY-2 — Auth runs after the first DB read, or fails open
- **Pattern:** business/DB code executes before auth is confirmed, or an exception in the
  auth check falls through to "allow." (`user?.id` optional-chained in a route that
  *requires* auth is a lie.)
- **Day-1 prevention:** `auth()` is the first line of every handler; fail *closed* — any
  exception in an auth check rejects the request.
- **Probe:** for each protected handler, is auth the first statement? Does the auth catch
  reject or pass?

### BOUNDARY-3 — Soft-delete doesn't actually revoke
- **Pattern:** an auth/lookup query checks the token/PK but not `deleted_at IS NULL`, so
  soft-deleted users keep valid sessions — an auth bypass. (Mnemo: caught in audit before
  a prod deletion, but it was live.)
- **Day-1 prevention:** when soft-delete is added to a model, grep *every* auth/read query
  touching that table and add the `deleted_at IS NULL` filter in the same change.
- **Probe:** grep queries against soft-deletable tables; does each filter deleted rows?

### BOUNDARY-4 — Tenant/owner column missing from a write's WHERE
- **Pattern:** an update/delete filters on PK only, letting any authenticated user mutate
  another tenant's row (IDOR).
- **Day-1 prevention:** tenant/owner column in *every* write WHERE, not just the PK.
  `LIMIT` on every user-facing read.
- **Probe:** grep `UPDATE`/`DELETE`/owner-scoped `SELECT`; is the owner column in the
  predicate?

### BOUNDARY-5 — Config that should be in the DB is hardcoded in env vars
- **Pattern:** an allowlist that requires a deploy to extend (e.g. OAuth `redirect_uri`
  origins in an env var). Breaks the moment a second client appears; every addition is a
  redeploy. (Mnemo: should have been DB-stored dynamic client registration per RFC 8252.)
- **Day-1 prevention:** auth/tenant configuration lives in the DB, validated dynamically.
  Env vars are for secrets and deploy-time constants, not per-entity config.
- **Probe:** grep env-var allowlists used in request validation. Should they be DB rows?

### BOUNDARY-6 — Sanitizer/guard wired to one path, not the full write surface
- **Pattern:** a PII scrubber / content fence / rate limiter is built and wired to one
  endpoint while every other write path bypasses it. False confidence. (Mnemo:
  `pii_scrubber` covered feedback submit; every MCP write tool wrote raw text.)
- **Day-1 prevention:** when you build a cross-cutting guard, enumerate *every* write path
  and wire all of them in the same session. A guard on one path is documentation.
- **Probe:** find the guard; enumerate all write entry points; is each one behind it?

---

## Theme E — Hot-Path Performance

**Applies to:** any project with a latency-sensitive protocol/auth/tool path.

### PERF-1 — Blocking call introduced into the hot path
- **Pattern:** a synchronous loopback or blocking IO added to a per-request path. (Mnemo:
  one `GET /me` loopback added 12,291 ms to *every* MCP tool call; no gate caught it.)
- **Day-1 prevention:** a latency gate (runs <30 s locally, enforces avg <500 ms / p95
  <1000 ms) on any commit touching a protocol/auth hot path. No blocking IO in `async`.
- **Probe:** grep the hot path for synchronous network/DB calls, loopbacks, blocking
  `open`/`sleep`/`requests`. Is there a latency gate in CI?

### PERF-2 — Independent awaits run sequentially
- **Pattern:** two awaits with no data dependency run one-after-the-other, doubling
  latency for free. (Stryde safety-state load was 8× a single round-trip until parallelized.)
- **Day-1 prevention:** `Promise.all` / `asyncio.gather` by default; sequential only when
  the first feeds the second.
- **Probe:** grep handlers for consecutive `await`s with no dependency between them.

### PERF-3 — Auth verification hits the DB on every call
- **Pattern:** token verification does a `pool.acquire()` per request; under pool pressure
  a miss silently kills every concurrent call.
- **Day-1 prevention:** auth verify is an in-memory TTL cache; never acquire a connection
  for a token check.
- **Probe:** does the auth-verify path touch the connection pool, or a cache?

---

## Theme F — QA as a Gate (not an afterthought)

*The reliability you ship is a property of the QA architecture, not of the model or of
good intentions. Measurement honesty is a prerequisite for trusting any of it.*

**Applies to:** every project.

### QA-1 — Panel/review runs after commit instead of before
- **Pattern:** security/correctness review happens post-hoc; findings (IDOR, scope gaps)
  become follow-up tasks instead of blockers. A review after commit is documentation, not
  quality control.
- **Day-1 prevention:** the review panel runs *before* each unit commits; FAILs are
  blockers. Tier the panel by risk so it's cheap on low-risk diffs.
- **Probe:** in the workflow, does the panel gate the commit or trail it?

### QA-2 — Tests are written after the code (or not at all)
- **Pattern:** "I'll add tests later." Every new gate/enum/format ships without a test
  entering at the public entry point.
- **Day-1 prevention:** tests are part of the deliverable, same change as the code. Every
  new gate gets one test that enters at the entry point and asserts the gate fired; every
  new format gets one load→process→output test.
- **Probe:** do recent feature commits include their tests? Is there a test at the entry
  point for each gate?

### QA-3 — Measurement isn't honest (noise counted as signal)
- **Pattern:** pass counts that aren't comparable run-to-run — shifting denominators,
  execution-order contamination (one scenario's state bleeds into the next), "didn't
  throw" counted as "passed." (Stryde: a "18 PASS" headline where 6 were quality scenarios
  that only avoided an error, and a return-to-training scenario poisoned ~10 downstream.)
- **Day-1 prevention:** classify every result — **VPASS** (deterministic assertion held) /
  **VFAIL** (real bug) / **QUAL** (needs a judge) / **ART** (harness artifact) / **NA**
  (not runnable). Only VPASS/VFAIL count toward progress. Per-scenario isolation
  (reset mutable state between scenarios). Test-mode time windows match prod.
- **Probe:** are test results classified, or is it one pass/fail number? Is there
  per-scenario state isolation? Do test-mode TTLs match prod?

### QA-4 — Seam defects (L2) misdiagnosed as model/quality failures (L1)
- **Pattern:** a deterministic writer→reader contract drift (enum mismatch, singular/plural,
  alias drift, unit mismatch) is dismissed as "the LLM hallucinated." It didn't — it
  faithfully reported corrupt data. The bug reproduces with no LLM in the loop.
- **Day-1 prevention:** classify bugs by root cause — **L1** (judgment error: fix the
  prompt/tool description) vs **L2** (deterministic seam defect: fix the contract). Every
  L2 finding references a seam-contract ID or adds one. L2s are cheaper to fix and more
  important to catch — they're invisible to the model.
- **Probe:** when output looks wrong, can you reproduce it by calling the tools directly
  with no model? If yes it's L2 — is there a seam contract covering it?

### QA-5 — No regression baseline / audit ledger
- **Pattern:** each audit run is a one-off; there's no dated ledger of what passed at which
  build, so regressions aren't detectable.
- **Day-1 prevention:** a dated audit ledger (run → build SHA → VPASS/VFAIL counts →
  notes). The latest clean sweep is the regression baseline.
- **Probe:** is there a docs/audits ledger with comparable, dated runs?

---

## Theme G — Agentic Governance (TKA)

*Fires only when an LLM/agent can take consequential action — write state, loop
autonomously, hold memory, or spawn sub-agents. A plain chatbot is safe because the human
is the gate; the reliability you feel there is a property of the architecture, not the
model. The moment you add MCP tools / autonomy / memory / sub-agents, four authority
leaks wake up. Name them T-K-A-P.*

**Applies to:** LLM-client / MCP-server / multi-agent systems only. Skip for
non-agentic projects.

### AGENT-T — Totem: the model commits its own writes with no independent downstream check
- **Pattern:** the LLM is simultaneously the reasoning engine, rule enforcer, and
  executor — the fox guards the henhouse. It can fabricate the proof-of-validity token,
  or ignore it. (Stryde: `weeklyPlanId` was supposed to prove a plan came from the
  deterministic planner; the coach could hand-craft a plan and claim it was real.)
- **Day-1 prevention:** a deterministic layer the model can't reason around. Two-stage
  commit for write tools — no `confirmed` param = preview only; the model proposes, the
  deterministic layer commits. Gate-exempt sets defined at *module scope*, not inside the
  handler (a gate the handler can reconfigure is not a gate).
- **Probe:** can the model's output alone cause a state write with no independent check?
  Are gate/exempt sets module-scoped or request-scoped?

### AGENT-K — Kick: the model is the final authority on when to stop
- **Pattern:** an autonomous loop where the model decides its own termination — it can
  loop forever or talk its way out of a stop by reframing the next turn.
- **Day-1 prevention:** stop conditions are deterministic and session-sticky. Once a
  convergent-stop / safety-stop fires, it survives across turns; the model cannot reset it
  by rewording. (Stryde: `CONVERGENT_STOP_SIGNAL` made session-sticky.)
- **Probe:** is there a turn/loop cap enforced outside the model? Does a safety stop
  persist across turns?

### AGENT-A — Architect: the model extends its own category space at runtime
- **Pattern:** the model invents new categories/types/tools/permissions at runtime,
  drifting outside the space it was designed to operate in.
- **Day-1 prevention:** the category space (enums, tool set, permission scopes) is fixed
  at build time; runtime additions are rejected, not absorbed. Ties directly to SEAM-3.
- **Probe:** can the model introduce a value/category the persistence layer hasn't seen?
  Is there an extraction/category gate?

### AGENT-P — Point Man: an agent borrows authority it was never granted
- **Pattern:** in multi-agent systems, a sub-agent acts on its parent's credentials, or
  finds a broader token and escalates. Authority provenance is lost across delegation.
- **Day-1 prevention:** authority is passed explicitly with a delegation path and depth;
  a sub-agent's writes carry *its* provenance, not an inherited blanket credential.
- **Probe:** when an agent spawns a sub-agent, is the sub-agent's authority scoped and
  attributed, or inherited wholesale?

### AGENT-I — Idempotency key on every write (LLM clients retry)
- **Pattern:** a write tool with no idempotency key. LLM clients retry on timeout (not
  just network error), so one logical action is written twice. (Stryde: `log_workout`
  double-wrote; load math counted two real sessions. The model did exactly what it was
  told.)
- **Day-1 prevention:** every write tool accepts an optional `idempotency_key` (derive
  from an input hash if omitted), stored with a unique constraint; return the existing
  record on conflict.
- **Probe:** does each write tool have an idempotency key + unique constraint?

---

## Theme H — Strategy & Process

*Choices made once that cost sprints to reverse. Cheap to get right up front, expensive
to undo.*

**Applies to:** every project (judgment-level, not grep-level).

### PROC-1 — Datastore sprawl (a second store for what the first covers)
- **Pattern:** reaching for Redis / a dedicated vector DB / a second source of truth for
  something the primary store handles. Each adds a failure domain, a backup strategy, and
  cache-coherence bugs. (Mnemo: 9 systems on Redis, then a 140-test sprint to remove it;
  ChromaDB instinct where `pgvector` was already available.)
- **Prevent:** before adding a datastore, ask whether `Postgres UPSERT + index + TTL
  column` (or `pgvector`) covers it. It usually does. One store is simpler than two.

### PROC-2 — Fork when a port would do (wrong layer)
- **Pattern:** forking the whole app for a change that lived in the service layer, not the
  HTTP/framework layer. A fork carries separate CI, migration history, test suites, and a
  perpetual merge tax. (Mnemo: enterprise fork reversed 5 days later — RBAC/threads/consent
  were service-layer-portable.)
- **Prevent:** before forking, answer one question — is the new behavior in the framework
  layer or the service/domain layer? Service-layer changes port; they don't need a fork.

### PROC-3 — Observability designed after incidents, not before
- **Pattern:** the metrics/circuit-breaker/latency framework is built *after* the prod
  degradation it would have caught. Excellent framework, week-4 timing.
- **Prevent:** minimum viable observability (latency gate, error rate, cost per call) runs
  before any user sees the product. Retrofitting after incidents is expensive and the
  incidents were avoidable.

### PROC-4 — Wrong model tier for the task
- **Pattern:** a state machine / security-critical / 30+-test task handed to a cheap tier,
  producing a shallow implementation that misses critical transitions.
- **Prevent:** Haiku for mechanical (rename, copy a pattern); Sonnet for spec-driven
  multi-file features; Opus for state machines, architecture, security-critical, 30+ tests.

### PROC-5 — Logging a task instead of doing it
- **Pattern:** a small fixable issue noted to a thread/task and not acted on; it resurfaces
  two sessions later as a blocker. Logging is not a work unit.
- **Prevent:** if it fits in the current session, do it. Only log what genuinely needs a
  future session or an external dependency.

### PROC-6 — Autonomous deploy / conflating commit, push, deploy
- **Pattern:** the model deploys (or pushes) because a commit was "ready," assuming commit
  implies deploy.
- **Prevent:** commit and stop; state what's ready; wait for explicit approval. Push ≠
  commit, deploy ≠ push. Deploys are manual.

---

## The two meta-lessons

**Execution:** most failures share a structure — a local check passed while a downstream
invariant was already broken. Trace the full path before declaring anything done.

**Design:** the design mistakes cluster around *building for the happy path and assuming
the constraint is temporary* — "we'll only ever have one client," "that's the only entry
point," "requests won't burst," "this fallback rarely triggers." Every "this is temporary
/ we'll only ever" assumption is a design risk to eliminate in the current sprint, not
defer.

---

*Source incidents: Stryde headless coach (`STABILITY_ARCHITECTURE.md`,
`docs/retrospective-arc-draft.md`, `GAPS_LOG.md`, `docs/audits/INDEX.md`) and Mnemo
(`docs/LESSONS-LEARNED.md`). TKA framework: `TKA_WHITEPAPER.md`.*
