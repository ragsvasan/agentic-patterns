# `/critical-gap-audit` Skill Definition

Save this as `.claude/skills/critical-gap-audit.md` in your project (or in
agentic-patterns for shared use). When a session runs `/critical-gap-audit`, it
executes this skill.

---

## Skill: critical-gap-audit

**Trigger:** `/critical-gap-audit [path]`

**Purpose:** Audit ANY project (any stack) for the stability gap classes that cause
silent production failures — the writer→reader seam drifts, silent-failure handlers,
migration-chain breaks, boundary bypasses, hot-path regressions, QA-honesty gaps, and
(for agentic systems) TKA authority leaks. Broader than `/audit-mcp`, which only covers
MCP tool ergonomics. Produces a PASS / FAIL / PARTIAL / N-A table with file + line
references and a prioritized "these will bite you" shortlist.

**The skill does NOT fix code — it audits and reports only.** No edits, no commits.

**Source of truth:** the gap taxonomy at `../docs/STABILITY_GAP_TAXONOMY.md` (relative
to this skill). **Read it first** — every gap-class ID, its "Probe" line, and its day-1
prevention come from there. If the taxonomy changes, this skill follows it; do not
invent gap classes the taxonomy doesn't define. You may add concrete probe commands.

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
```

Decide and announce:
- **Language(s):** Python / TypeScript / other.
- **DB + migrations present?** If no migrations → mark all MIG-* as **N-A**.
- **Agentic / MCP / LLM-client system?** If no (a plain CLI/web app with no LLM writing
  state, no autonomous loop, no sub-agents) → mark all AGENT-* as **N-A**.

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
- **MIG-3** NOT NULL added without DEFAULT, INSERTs unpatched —
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
  pass/fail number? Per-scenario state isolation? Test-mode TTLs match prod?
- **QA-4** seam defects (L2) misdiagnosed as model failures (L1) — when output looks wrong,
  can you reproduce by calling tools directly with no model? Is there a seam contract for it?
- **QA-5** no regression baseline / ledger — is there a dated `docs/audits/` ledger with
  comparable runs (run → build SHA → counts)?

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
  `grep -rn "delegation\|agent_context\|authorized_by\|spawn" $ROOT`.
- **AGENT-I** idempotency — `grep -rn "idempotency\|idempotent\|ON CONFLICT\|onConflict" $ROOT`;
  does each write tool accept an idempotency key with a unique constraint?

**Theme H — Strategy & Process** *(judgment-level — assess, don't grep-gate)*
- **PROC-1**..**PROC-6** (datastore sprawl, fork-vs-port, observability timing, model tier,
  log-vs-do, autonomous deploy) — note any you observe from repo structure/history as
  PARTIAL/observation; these are advisory, not pass/fail gates.

### Step 3 — Report

Emit **one consolidated table grouped by theme** (A–H), each row: `ID | gap | status |
file:line evidence`. Then a prioritized **"These will bite you"** shortlist: every FAIL
first, ordered by blast radius (silent data corruption / auth bypass > latency > ergonomics),
each line ending with the taxonomy's **day-1 prevention** as the recommended fix. PARTIALs
follow. Close with: *"Report only — no edits applied."*

Blast-radius ordering hint: SEAM-1/2/5, FAIL-1/2, BOUNDARY-2/3/4, MIG-3, AGENT-T/I are
silent-corruption or security class → top. PERF-* → middle. QA-* / PROC-* → context.

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
