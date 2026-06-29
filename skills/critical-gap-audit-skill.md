# `/critical-gap-audit` Skill Definition

Save this as `.claude/skills/critical-gap-audit.md` in your project (or in
agentic-patterns for shared use). When a session runs `/critical-gap-audit`, it
executes this skill.

---

## Skill: critical-gap-audit

**Trigger:** `/critical-gap-audit [path]`

**Purpose:** Audit ANY project (any stack) for the stability gap classes that cause
silent production failures — the writer→reader seam drifts, silent-failure handlers,
migration-chain breaks, boundary bypasses, hot-path regressions, QA-honesty gaps,
resilience-under-load gaps, distributed-correctness (dual-write) gaps, and
(for agentic systems) TKA authority leaks plus the adversarial S/W surface. Broader than
`/audit-mcp`, which only covers MCP tool ergonomics. Produces a PASS / FAIL / PARTIAL /
N-A table with file + line references and a prioritized "these will bite you" shortlist.

**Coverage:** 11 themes (A–K), ~48 gap classes.

**The skill does NOT fix code — it audits and reports only.** No edits, no commits.

**Source of truth:** the gap taxonomy at `/Users/rags/agentic-patterns/docs/STABILITY_GAP_TAXONOMY.md`.
**Read it first** — every gap-class ID, its "Probe" line, and its day-1 prevention come
from there. If the taxonomy changes, this skill follows it; do not invent gap classes the
taxonomy doesn't define. You may add concrete probe commands.

---

## Skill Instructions

You are auditing a codebase against the stability gap taxonomy. Read, assess, report.
Do not fix anything.

### Step 1 — Detect the stack (cheap greps), state it up front

Before probing, classify the project so you can skip inapplicable classes. State the
detected stack as a one-line header in your report.

```bash
ROOT="${1:-.}"
# Language
ls "$ROOT"/{package.json,tsconfig.json} 2>/dev/null      # TypeScript / JS
ls "$ROOT"/{pyproject.toml,requirements.txt,setup.py} 2>/dev/null  # Python
# DB + migrations
ls "$ROOT"/alembic*/ "$ROOT"/**/migrations/ "$ROOT"/drizzle/ 2>/dev/null
grep -rlE "asyncpg|psycopg|drizzle-orm|pg\b|sqlalchemy" "$ROOT" --include="*.ts" --include="*.py" 2>/dev/null | head
# Agentic? (AGENT-* applies ONLY if this hits)
grep -rlE "tools/list|inputSchema|@mcp\.tool|McpServer|tool_use|create_task|spawn.*agent|subagent" "$ROOT" --include="*.ts" --include="*.py" 2>/dev/null | head
# Scaled / external-dependency / LLM-retry? (RESIL-* applies ONLY if this hits)
ls "$ROOT"/{Dockerfile,cloudbuild.yaml,*.yaml,k8s*,helm*} 2>/dev/null    # autoscaled deploy
grep -rlE "fetch\(|httpx|requests\.|aiohttp|pool\.acquire|createPool|new Pool|max_connections|autoscal|min_instances|max_instances|retry|backoff" "$ROOT" --include="*.ts" --include="*.py" --include="*.yaml" 2>/dev/null | head
# Multi-store / dual-write? (DIST-* applies ONLY if a write spans >1 store/service)
grep -rlE "outbox|saga|compensat|publish.*event|webhook|enqueue|\.send\(|second.*service|cross.*service" "$ROOT" --include="*.ts" --include="*.py" 2>/dev/null | head
```

Decide and announce:
- **Language(s):** Python / TypeScript / other.
- **DB + migrations present?** If no migrations → mark all MIG-* as **N-A**.
- **Agentic / MCP / LLM-client system?** If no (a plain CLI/web app with no LLM writing
  state, no autonomous loop, no sub-agents) → mark all AGENT-* (T/K/A/P/I and the
  adversarial **S/W**) as **N-A**.
- **Horizontally-scaled / external-dependency / LLM-retry system?** RESIL-* applies if the
  service is autoscaled (Cloud Run / k8s / replicas), fronts a shared datastore, calls an
  external dependency on a request path, or is driven by an LLM client that can retry. A
  single-instance local CLI with no external request path → mark all RESIL-* as **N-A**.
- **Does any single logical action write to >1 store / service / external system?** DIST-*
  applies only then (two services, or a DB table plus an external queue/API/webhook). A
  strictly single-database system → mark all DIST-* as **N-A**.
- **Rolling deploy?** If the deploy is rolling (Cloud Run / k8s — old and new containers
  serve concurrently), MIG-5 applies. A stop-the-world / single-instance deploy → MIG-5 **N-A**.

### Step 2 — Probe each gap class

For each class, run its probe (taxonomy's "Probe" line; concrete recipes below), then
assign **PASS** / **FAIL** / **PARTIAL** / **N-A** with `file:line` evidence. PARTIAL =
guard exists but doesn't cover the full surface. N-A = class doesn't apply to this stack.

Grep recipes (Python `.py` and TypeScript `.ts` variants where relevant):

**Theme A — Seam Integrity** *(every project with persistence or >1 module)*
- **SEAM-1** write-alias / read-canonical drift — grep the type/enum string written vs.
  queried; same canonical constant on both sides, or string literals each side?
  `grep -rn "normalize\|canonical\|toCanonical" $ROOT` then diff write-site vs read-site literals.
- **SEAM-2** writer→reader contract matrix — is there a seam/contract registry or matrix?
  `grep -rln "SeamContract\|contract matrix\|round-trip\|roundtrip" $ROOT`. For each write
  entry point, is there a test that writes then reads back through a *different* tool and
  asserts the value survives?
- **SEAM-3** new enum/ID added in one place not all — `grep -rn "switch\s*(\|match " $ROOT`;
  does each branch handle the newest variant, and is there a `default: never` (TS) /
  `case _ as unreachable` (Py)? Totality test for alias→canonical?
- **SEAM-4** multiple entry points, fix on wrong one — grep sibling impls of the same op:
  `grep -rln "dedup\|normalize\|def log_\|function log" $ROOT`. ≥2 implementations sharing
  no code path = FAIL risk.
- **SEAM-5** cross-table numeric expr, unit mismatch — find ratio/delta/percentage
  expressions spanning two tables/sources; is the unit asserted anywhere; golden-value test?

**Theme B — Failure Honesty** *(every project)*
- **FAIL-1** silent exception swallow near IO — Py: `grep -rn "except Exception\|except:" $ROOT`;
  TS: `grep -rn "catch (e\|catch(e\|catch (_" $ROOT`. For each near a DB/network call: does
  it re-throw / log / return a typed error, or silently absorb an unexpected type?
- **FAIL-2** JSON/cache fallback on DB failure — grep for file/JSON writes or cache reads
  *inside* DB-error handlers: `grep -rn -A4 "except\|catch" $ROOT | grep -iE "json|cache|fallback|writeFile"`.
- **FAIL-3** loose mocks hide signature drift — `grep -rn "MagicMock(\|jest.fn()\|vi.fn()\|lambda" $ROOT/test*`;
  are DB/external mocks signature-enforced (`create_autospec` / typed doubles)?
- **FAIL-4** timeout-free background async — `grep -rn "create_task\|asyncio.ensure_future\|setTimeout\|void .*(" $ROOT`;
  does each detached coroutine/promise have `wait_for` / `AbortSignal.timeout`, and is the
  task reference stored?
- **FAIL-5** "fixed" without regression test first — for recent `fix(` commits
  (`git log --oneline -20 | grep -i fix`), is there a paired `test_regression_*` /
  `*.regression.test` entering at the public entry point?

**Theme C — Migration & Schema** *(skip → N-A if no migrations)*
- **MIG-1** out-of-band schema change — does prod schema match `migrate head` on a clean DB?
  grep migration history for `stamp`/manual-sync notes.
- **MIG-2** code references table/column with no migration in same commit — grep new
  table/column names in code; confirm a migration in the same change creates them.
- **MIG-5** destructive migration under a rolling deploy (no expand/contract) — *(N-A unless
  the deploy is rolling — Cloud Run / k8s with old+new containers serving concurrently)*.
  Does any migration add a `NOT NULL`-without-default, rename, drop, or type-narrow in a
  single revision? grep `op.add_column.*nullable=False`, `op.alter_column`, `op.drop_column`,
  `RENAME`, `ALTER COLUMN .* TYPE` across migrations. **FAIL** if a single revision mutates
  existing structure and the deploy is rolling with no expand/contract split. **PARTIAL** if
  some migrations follow expand/contract but at least one mutating revision does not.
  **PASS** if every structural change ships additive-only (expand) with backfill + contract
  deferred until old containers retire.
  `grep -rn "INSERT INTO <table>" $ROOT`; does each include every NOT NULL column?
- **MIG-4** tests run on clean DB not prod snapshot — any tables created outside migrations
  (at app startup)? Does CI seed from `pg_dump --schema-only`?

**Theme D — Boundary Enforcement** *(every project with auth / tenancy / external input)*
- **BOUNDARY-1** validation not at entry boundary — grep handlers for unparsed
  `data["..."]` / `body.foo` / `req.body.` without a Zod/Pydantic parse at the handler.
- **BOUNDARY-2** auth after first DB read / fails open — for each protected handler, is
  `auth()` the first statement? Does the auth catch reject (closed) or pass (open)?
  Watch `user?.id` in routes that require auth.
- **BOUNDARY-3** soft-delete doesn't revoke — `grep -rn "deleted_at\|isDeleted\|deletedAt" $ROOT`;
  do auth/read queries on soft-deletable tables filter `deleted_at IS NULL`?
- **BOUNDARY-4** tenant/owner column missing from write WHERE —
  `grep -rn "UPDATE \|DELETE FROM\|\.update(\|\.delete(" $ROOT`; is the owner column in the
  predicate, not just the PK? `LIMIT` on user-facing reads?
- **BOUNDARY-5** config that should be DB-stored hardcoded in env — grep env-var allowlists
  used in request validation (`process.env`/`os.environ` in an auth/redirect check).
- **BOUNDARY-7** SSRF via an agent-synthesized URL or identifier — grep tools that take a
  URL/host/identifier and fetch it: `grep -rn "fetch(\|httpx\|requests\.\|aiohttp\|urlopen" $ROOT`
  cross-referenced with model-supplied/tool args. For each, is the resolved destination
  allowlisted (scheme + host) and are private/link-local ranges (`169.254.0.0/16`, `10/8`,
  `127/8`, `::1`) blocked *after DNS resolution* (anti-rebinding)? Watch especially for fetch
  of the cloud metadata endpoint `169.254.169.254`. **FAIL** if a model-influenced URL is
  fetched with no allowlist / no private-range block. **PARTIAL** if allowlisted by scheme/host
  but no post-resolution IP check. **N-A** if no tool fetches a model-influenced URL (non-agentic).
- **BOUNDARY-6** sanitizer/guard wired to one path, not all — find the guard
  (scrubber / fence / rate limiter); enumerate every write entry point; is each behind it?

**Theme E — Hot-Path Performance** *(any latency-sensitive protocol/auth/tool path)*
- **PERF-1** blocking call in hot path — grep the per-request path for sync network/DB,
  loopbacks, blocking `open`/`time.sleep`/`requests` inside `async def`. Latency gate in CI?
- **PERF-2** independent awaits sequential — grep handlers for consecutive `await`s with no
  data dependency (candidates for `Promise.all` / `asyncio.gather`).
- **PERF-3** auth verify hits DB every call — does the token-verify path `pool.acquire()` /
  query per request, or use an in-memory TTL cache?

**Theme F — QA as a Gate** *(every project)*
- **QA-1** panel/review after commit not before — in the workflow/docs, does the review
  gate the commit or trail it?
- **QA-2** tests written after code — do recent feature commits include their tests? Test
  at the entry point for each new gate?
- **QA-3** measurement not honest — are results classified (VPASS/VFAIL/QUAL/ART/NA) or one
  pass/fail number? Per-scenario state isolation with `try/finally` teardown? Fresh UUID
  test tenant per run or shared constant (`test-user-001`)? **testMode TTLs ≥ production
  TTLs** at every gate-read site (a 30-min test window vs 48h prod window makes long audit
  runs flaky at minute 31 — Stryde incident 2026-06-14). **Test seeds use past dates** (≥2
  days ago) for time-sensitive policies, never "today" (same-day seeds contaminate every
  downstream scenario that checks today's load/state).
- **QA-4** seam defects (L2) misdiagnosed as model failures (L1) — when output looks wrong,
  can you reproduce by calling tools directly with no model? Is there a seam contract for it?
- **QA-5** no regression baseline / ledger — is there a dated `docs/audits/` ledger with
  comparable runs (run → build SHA → counts)?
- **QA-6** tautological assertions (coverage without fault detection) — is there a
  mutation-testing run on the business-logic core, or only a line-coverage number?
  `grep -rln "stryker\|mutmut\|cosmic-ray\|mutation" $ROOT` + config files. **FAIL** if there's
  a coverage number but no mutation run on the logic core (a sub-50% mutation score under 80%
  line coverage is the tautological-test signature). **PARTIAL** if mutation testing exists but
  no CI mutation-score floor on critical modules. Spot-check: pick one critical function,
  invert an operator (`>`→`<`, `+`→`-`) — does any test fail?
- **QA-8** log-parsing fragility — grep for test assertions that match on internal log
  fields: `grep -rn "l\.level\|l\.event\|\.event ===\|caplog\|LogCapture\|log.*called\|assert.*log" $ROOT/test*`. For each: is there an alternative assertion on observable output
  (return value, DB state, HTTP response)? Would the test pass if warn-level logs were
  filtered out (as in many staging/CI configs)? **FAIL** if a test's only assertion is
  on log output and the log level could be filtered. **PARTIAL** if log assertion exists
  alongside an observable-output assertion.
- **QA-7** no oracle for non-deterministic output (missing metamorphic relations) — for each
  non-deterministic/LLM tool, is there at least one *metamorphic relation* asserted (relative
  behavior across related inputs — longer workout ⇒ strictly higher estimate, etc.) rather than
  a brittle/absent exact-string match? Is the untrusted-input boundary property-fuzzed
  (`grep -rln "fast-check\|hypothesis\|fuzz\|@given" $ROOT`)? **FAIL** if a probabilistic
  component has no metamorphic relation and no boundary fuzz. **PARTIAL** if one but not both.

**Theme G — Agentic Governance (TKA)** *(LLM-client / MCP / multi-agent ONLY; else N-A)*
- **AGENT-T** Totem — can the model's output alone cause a state write with no independent
  check? Two-stage commit (no `confirmed` = preview)? Gate/exempt sets module-scoped, not
  inside the handler? `grep -rn "GATE_EXEMPT\|confirmed" $ROOT`.
- **AGENT-K** Kick — is there a turn/loop cap enforced outside the model? Does a safety stop
  persist across turns (session-sticky)? `grep -rn "STOP\|max_turns\|turn_cap\|convergent" $ROOT`.
- **AGENT-A** Architect — can the model introduce a category/type the persistence layer
  hasn't seen? Is the category space (enums/tools/scopes) fixed at build time?
- **AGENT-P** Point Man — when an agent spawns a sub-agent, is the sub-agent's authority
  scoped and attributed (delegation path + depth), or inherited wholesale?
  `grep -rn "delegation\|agent_context\|authorized_by\|spawn" $ROOT`. Also: are pass-through
  tokens audience-checked (`aud`/scope vs the *user's* session) before forwarding, and can a
  second connected server shadow a canonical tool name (tool-shadowing / confused deputy)?
- **AGENT-S** semantic injection through the data / tool-result channel — trace each
  consequential tool's arguments back to their source: can any be influenced by
  attacker-controlled *stored/retrieved/synced* content (a log title, a synced route
  description, a RAG document)? Shape validation (BOUNDARY-1) is blind to *meaning*. Is that
  content fenced (BOUNDARY-6 scrubber on **every** external-data write path) AND is the tool
  gated by a deterministic structural check (AGENT-T) rather than by the model reading the
  fence? **FAIL** if a consequential tool's args can carry attacker-controlled content and the
  gate is the model's own judgment. **PARTIAL** if fenced but the gate is still model-side.
  **N-A** for non-agentic systems.
- **AGENT-W** denial of wallet — is there a per-session/per-user budget enforced *outside* the
  model: a hard ceiling on tool-call count, token spend, and wall-clock per task?
  `grep -rn "budget\|max_tokens\|token.*ceiling\|cost.*limit\|max_turns\|rate.*limit" $ROOT`.
  AGENT-K bounds the loop for correctness; AGENT-W bounds it for *cost* under an adversarial
  request. **FAIL** if nothing stops a single user from driving unbounded LLM spend in one
  session. **PARTIAL** if a turn cap exists (AGENT-K) but no token/cost/wall-clock ceiling.
  **N-A** for non-agentic systems.
- **AGENT-I** idempotency — `grep -rn "idempotency\|idempotent\|ON CONFLICT\|onConflict" $ROOT`;
  does each write tool accept an idempotency key with a unique constraint?

**Theme H — Strategy & Process** *(judgment-level — assess, don't grep-gate)*
- **PROC-1**..**PROC-6** (datastore sprawl, fork-vs-port, observability timing, model tier,
  log-vs-do, autonomous deploy) — note any you observe from repo structure/history as
  PARTIAL/observation; these are advisory, not pass/fail gates.

**Theme I — Resilience Under Load & Cascading Failure** *(horizontally-scaled / external-
dependency / LLM-retry systems ONLY; else N-A — see Step 1 gating)*
- **RESIL-1** integration point with no circuit breaker — grep cross-process calls
  (`grep -rn "fetch(\|httpx\|requests\.\|aiohttp\|pool.acquire\|client.call\|mcp.*call" $ROOT`).
  Is any wrapped in a breaker (open after N failures / a latency threshold, fail fast while
  open, half-open probe), or does each block indefinitely on a slow peer?
  `grep -rln "circuit\|breaker\|CircuitBreaker\|opossum\|pybreaker\|tenacity" $ROOT`. **FAIL**
  if cross-process calls have no breaker. **PARTIAL** if some integration points are wrapped
  and others aren't.
- **RESIL-2** no bulkhead / shared pool with no partition — is there one global connection /
  thread pool / event loop for everything, or per-dependency partitions (a bounded pool or
  concurrency semaphore per external dependency class)? `grep -rn "createPool\|new Pool\|create_pool\|Semaphore\|bulkhead\|max_size\|pool_size" $ROOT`. **FAIL** if a single slow
  downstream can consume every connection of one shared pool. **PARTIAL** if some deps are
  partitioned, core path is not.
- **RESIL-3** unbounded retry → request storm → pool exhaustion — is there a retry/backoff
  policy AND a client-side throttle? `grep -rn "retry\|backoff\|jitter\|throttle\|max_attempts" $ROOT`. Compute `max_instances × pool_size` — does it exceed Postgres `max_connections`?
  **FAIL** if retries have no backoff/throttle OR `max_instances × pool_size > max_connections`.
  **PARTIAL** if backoff exists but no adaptive client-side throttle, or the pool-math headroom
  is unverified. (AGENT-I makes retries *safe*; RESIL-3 *bounds their rate* — distinct.)
- **RESIL-4** no timeout budget on the synchronous tool path — grep synchronous external calls
  on the request path; does each have a deadline (`AbortSignal.timeout` / `asyncio.wait_for` /
  per-call statement timeout)? `grep -rn "wait_for\|AbortSignal.timeout\|statement_timeout\|timeout=" $ROOT`. Is there an overall request deadline (sum of hop deadlines, enforced)?
  **FAIL** if foreground external calls await with no deadline. **PARTIAL** if individual calls
  have timeouts but there's no end-to-end request budget. (FAIL-4 is the background version;
  RESIL-4 is the hot path.)

**Theme J — Distributed Correctness & Transactional Integrity** *(only when a single logical
action writes to >1 store / service / external system; else N-A — see Step 1 gating)*
- **DIST-1** dual write with no atomicity (lost-write / orphan) — grep for a DB write followed
  by an external/second-service call in the same handler with no outbox between them.
  `grep -rn -A6 "INSERT\|\.insert(\|UPDATE\|\.update(\|commit()" $ROOT | grep -iE "fetch|httpx|requests|publish|enqueue|\.send\(|client\."`. Is there an `outbox` table + publisher
  (`grep -rln "outbox\|transactional.*outbox\|wal\|processed = false" $ROOT`), or a raw dual
  write? **FAIL** if a local commit is followed by a second-store call with no outbox.
  **PARTIAL** if an outbox exists for some flows but at least one raw dual write remains.
  **N-A** if every write lands in a single store.
- **DIST-2** multi-step write across services with no compensation (saga) — find multi-write
  operations spanning ≥2 transactions/services. On a mid-sequence failure, is there a
  compensation path, or are early steps left orphaned? `grep -rln "saga\|compensat\|rollback.*step\|undo" $ROOT`. **FAIL** if a multi-service write sequence has no compensation
  on partial failure. **PARTIAL** if some steps compensate but not all. First check: could the
  writes collapse into *one* ACID transaction (most "distributed" writes are same-DB)? If so
  that's the finding. **N-A** if all writes share one transaction.
- **DIST-3** at-least-once delivery with a non-idempotent consumer — for each event / queue /
  webhook *consumer*, is there a dedupe on event ID or an idempotent apply (UPSERT / processed-
  ID unique constraint)? `grep -rn "webhook\|consume\|on_event\|handler.*event\|subscribe" $ROOT`
  cross-referenced with dedupe (`grep -rln "processed_ids\|event_id.*unique\|ON CONFLICT\|dedupe" $ROOT`). What happens if the same event is delivered twice? **FAIL** if a consumer applies
  events with no dedupe (double-charge / double-log risk). **PARTIAL** if some consumers dedupe.
  (AGENT-I dedupes the *producer's* write tool; DIST-3 is the *consumer* of the event stream.)
  **N-A** if there are no event/queue/webhook consumers.

**Theme K — LLM Interface Integrity** *(agentic / MCP / LLM-client ONLY; else N-A)*
- **IFACE-1** call trigger absent — read each tool description aloud. Does it contain a
  trigger condition ("call when…", "use before…", "invoke if the user says…") OR only a
  capability description? `grep -rn "description\|\"desc\"\|tool_description" $ROOT --include="*.ts" --include="*.py" | grep -v "^Binary"`. For each description lacking a trigger,
  run the scenario that should invoke it — does the LLM call it without being explicitly
  directed? **FAIL** if any consequential tool (especially data-fetching tools that gate
  coaching advice) has a description with no trigger condition. **PARTIAL** if some have
  triggers and others don't.
- **IFACE-2** schema-description-behavior three-way mismatch — for each tool, compare:
  (a) params in JSON/Zod schema, (b) params mentioned in description prose, (c) params
  actually read in the handler body (`grep -n "args\.\|input\.\|params\." handler`). Any
  param declared but not mentioned in description: **PARTIAL**. Any param declared but not
  read in handler: **FAIL** (silent discard). Any param described but not in schema: **FAIL**
  (LLM tries to send it; schema rejects). Contract test: pass the param, assert output
  changed.
- **IFACE-3** description debt / stale claims / false negations — grep all tool
  descriptions for mentions of other tool names by string: do those tools still exist in
  the manifest? `grep -ohE '"[a-z_]+"' $ROOT/manifest* | sort -u` vs `grep -ohE 'name: "[a-z_]+"' $ROOT/manifest*`. Any required params undocumented? Any description that asserts
  another tool "doesn't exist" or "is unavailable"? **FAIL** if any false negation or
  reference to a dead tool name. **PARTIAL** if undocumented required params only.

*(Add IFACE-* to Step 1 stack detection: only probe when `tools/list` / `inputSchema` /
`@mcp.tool` / `McpServer` is detected — same gating as AGENT-.)*

### Step 3 — Report

Emit **one consolidated table grouped by theme** (A–K), each row: `ID | gap | status |
file:line evidence`. Then a prioritized **"These will bite you"** shortlist: every FAIL
first, ordered by blast radius (silent data corruption / auth bypass / cloud-credential
exfil > availability/cascade > latency > ergonomics), each line ending with the taxonomy's
**day-1 prevention** as the recommended fix. PARTIALs follow. Close with: *"Report only —
no edits applied."*

Blast-radius ordering hint:
- **Top (silent corruption / security / credential exfil):** SEAM-1/2/5, FAIL-1/2,
  BOUNDARY-2/3/4/7, MIG-3/5, DIST-1/2/3, AGENT-T/P/S/I — and AGENT-W (cost) and BOUNDARY-7
  (SSRF → metadata-endpoint / SA-token exfil) sit at the top of the security band.
- **Availability / cascading failure:** RESIL-1/2/3/4 — a transient slow peer becoming a
  self-inflicted global blackout outranks plain latency.
- **Middle (latency / non-determinism):** PERF-* · IFACE-1/2/3 (tool-description flakiness
  outranks general latency because it causes silent wrong advice, not just slow advice).
- **Context (process / honesty):** QA-* (incl. QA-6/7/8) / PROC-*.

---

## Example Invocation

```
/critical-gap-audit src/
```

If no path given, audit the whole repo from its root.

---

## How to Register This Skill

- **Per project:** copy this file to `.claude/skills/critical-gap-audit.md` in the target
  project. Claude Code then makes `/critical-gap-audit` available in any session there.
  Keep `../docs/STABILITY_GAP_TAXONOMY.md` reachable, or update the relative path in
  Step 1 to point at the taxonomy's location.
- **Shared:** leave it here in `agentic-patterns/skills/` and invoke from a session rooted
  in agentic-patterns, or symlink it into a project's `.claude/skills/`.
- **Global:** copy to `~/.claude/skills/critical-gap-audit.md` to use across all projects.
