# Adversarial QA Agent — Design and Build Guide

**Purpose:** A self-contained brief for building an agent that continuously QA-tests
a headless MCP server. Written to be handed to a new session with no prior context.

**Companion docs in this repo:**
- `HEADLESS_MCP_ENGINEERING_GUIDE.md` — server-side design patterns
- `LLM_AS_UI_PATTERNS.md` — failure modes specific to LLM clients
- `STABILITY_ARCHITECTURE.md` — contract matrix, property tests, logic bug inventory

---

## Why This Exists

A headless MCP server has no UI. The client is an LLM. That combination produces failure
modes that standard code review and unit tests do not catch:

- Silent 200 responses with wrong data (no error, just incorrect result)
- Write→read contract breaks across files (write goes to table A, read queries table B)
- Normalization gaps (new alias from a new integration stored raw, never queryable)
- Safety gate bypasses (read tool accidentally blocked, write tool accidentally exempt)
- LLM-specific failures (stale context, hallucinated parameters, wrong tool order)

These bugs share a property: each component looks correct in isolation. The failure is
at the boundary between components. Code review catches component correctness. It does
not catch boundary failures unless someone explicitly checks them.

The goal of this agent is to be that someone — running continuously, without fatigue,
against a live environment.

---

## The Core Distinction: Cooperative vs Adversarial

Most AI code review agents are **cooperative**: they ask "does this code follow the patterns?"

This agent is **adversarial**: it asks "how do I break this?"

The difference:
- Cooperative agents read diffs and check against a checklist
- Adversarial agents call live tools with edge-case inputs and assert the system holds its invariants

Both are useful. Cooperative review catches pattern violations before code ships.
Adversarial QA catches runtime failures that only appear when the system is exercised.
This document is about the adversarial agent.

---

## What the Agent Does

Three distinct functions, in increasing difficulty:

### Function 1 — Test known invariants mechanically

Run the property tests and contract tests against the live environment on every PR and
on a nightly schedule. The agent doesn't reason — it executes and reports.

Examples of known invariants:
- Every known external alias normalizes to a non-null canonical type
- Writing metric X and querying for X returns the written value
- Read-only tools are in the bypass list; write tools are not
- A blocked user cannot call write tools; can call read tools

These are already written in `STABILITY_ARCHITECTURE.md`. This function mechanizes them.

### Function 2 — Probe known failure categories adversarially

Call tools with inputs designed to expose known failure modes:
- Hallucinated IDs (valid-looking UUIDs that don't exist)
- Raw aliases instead of canonical types
- Out-of-order tool calls (write before prerequisite read)
- Expired or replayed confirmation tokens
- Fields that pass JSON schema validation but are semantically wrong

For each probe, assert the response is a well-formed error with a resolution field —
not a silent 200 with wrong data, and not an unstructured 500.

### Function 3 — Generate uncomfortable questions

Examine the system's assumptions and probe ones that haven't been tested.

Examples:
- "We test that HRV normalizes correctly. Do we test that the safety gate reads
  from the same canonical type that the normalizer writes?"
- "We test the write→read round-trip for running workouts. Do we test it for
  swimming? Rowing? Strength?"
- "We test that the gate blocks writes. Do we test that it unblocks after the
  condition is resolved?"

This function requires the agent to have a model of the system's assumptions.
The coverage table in `STABILITY_ARCHITECTURE.md` is that model. Gaps in the table
are the questions the agent should ask.

---

## What the Agent Needs

### 1. A live test environment

The agent must call the real server. Mocks test themselves.

Requirements:
- A deployed instance the agent can reach (staging or a dedicated QA environment)
- Dedicated test user IDs — separate from real users, safe to write arbitrary data to
- An API key or auth token scoped to the test users
- A state reset mechanism — clean slate before each test run

State reset options (in order of preference):
- Test user IDs are ephemeral — provisioned per run, deleted after
- A `/test/reset` admin endpoint that truncates test user data
- A fixed test user whose data is wiped by a migration at run start

Without state reset, tests contaminate each other. A test that passes on a clean
database may fail when run after another test that left unexpected data.

### 2. A machine-readable scenario library

The scenarios in `E2E_TEST_SCENARIOS.md` are prose. The agent needs structured definitions.

```typescript
// tests/qa/fixtures/scenarios.ts

export interface QAScenario {
  id: string;
  description: string;
  tags: string[];
  steps: QAStep[];
  assert: (results: unknown[]) => AssertionResult;
}

export interface QAStep {
  tool: string;
  args: Record<string, unknown>;
  expectError?: string;  // if set, assert this error code is returned
}

export interface AssertionResult {
  pass: boolean;
  message: string;
}

// Example scenario
export const CONTRACT_HRV_ROUND_TRIP: QAScenario = {
  id: 'C-H1',
  description: 'HRV write via log_health_screenshot → readable via query_metric',
  tags: ['contract', 'normalization', 'hrv'],
  steps: [
    {
      tool: 'log_health_screenshot',
      args: {
        confirmed: true,
        metrics: [{ type: 'hrv_rmssd', value: 78, unit: 'ms', date: '2026-01-01' }],
      },
    },
    {
      tool: 'query_metric',
      args: { metricType: 'HRV', days: 1 },
    },
  ],
  assert: (results) => {
    const queryResult = results[1] as { records: { value: number }[] };
    const found = queryResult.records.some(r => r.value === 78);
    return {
      pass: found,
      message: found ? 'HRV record found' : `HRV record not found. Got: ${JSON.stringify(queryResult)}`,
    };
  },
};
```

### 3. A comparison oracle

The oracle defines what correct output looks like. Without it, the agent cannot
distinguish "different" from "wrong."

For contract tests: the oracle is the written value. Write 78, read 78.

For semantic correctness: the oracle must be defined upfront per scenario.
The agent cannot infer whether a readiness score of 42 is correct — it must be told.

For error cases: the oracle is the error code and the presence of a `resolution` field.

### 4. Tool call tracing

Every tool call must be logged with full params and response. Silent failures —
a 200 response with wrong data — are invisible without tracing.

```typescript
function wrapWithTracing(tools: ToolMap, log: Logger): ToolMap {
  return Object.fromEntries(
    Object.entries(tools).map(([name, fn]) => [
      name,
      async (args: unknown) => {
        const start = Date.now();
        try {
          const result = await fn(args);
          log.info('tool_call', { tool: name, args, result, durationMs: Date.now() - start });
          return result;
        } catch (e) {
          log.error('tool_error', { tool: name, args, error: e, durationMs: Date.now() - start });
          throw e;
        }
      },
    ])
  );
}
```

### 5. An adversarial probe library

Enumerated inputs designed to surface known failure categories.

```typescript
// tests/qa/fixtures/probes.ts

export const ADVERSARIAL_PROBES = [
  {
    id: 'PROBE-01',
    description: 'Write tool is blocked when a pain signal is active',
    setup: async (tools) => {
      await tools.log_pain_signal({ location: 'knee', severity: 7, confirmed: true });
    },
    probe: async (tools) => tools.log_workout({ type: 'running', durationMin: 60, confirmed: true }),
    assert: (result) => result.error?.code === 'SAFETY_SHELL_BLOCKED',
  },
  {
    id: 'PROBE-02',
    description: 'Read tool passes through when a pain signal is active',
    setup: async (tools) => {
      await tools.log_pain_signal({ location: 'knee', severity: 7, confirmed: true });
    },
    probe: async (tools) => tools.get_workout_history({ days: 7 }),
    assert: (result) => !result.error,
  },
  {
    id: 'PROBE-03',
    description: 'Unknown metric type emits warn log, does not silently vanish',
    probe: async (tools) => tools.log_health_screenshot({
      confirmed: true,
      metrics: [{ type: 'completely_unknown_metric_xyz', value: 42, unit: 'u', date: '2026-01-01' }],
    }),
    assert: (result, logs) => logs.some(l => l.level === 'warn' && l.event === 'unknown_entity_type_stored_raw'),
  },
  {
    id: 'PROBE-04',
    description: 'Confirmation token cannot be replayed',
    setup: async (tools) => {
      const preview = await tools.delete_workout({ workoutId: 'test-123' });
      return { token: preview.confirmationToken };
    },
    probe: async (tools, { token }) => {
      await tools.delete_workout({ confirmationToken: token }); // use once
      return tools.delete_workout({ confirmationToken: token }); // replay
    },
    assert: (result) => result.error?.code === 'TOKEN_EXPIRED_OR_USED',
  },
];
```

---

## Agent Architecture

```
┌──────────────────────────────────────────────┐
│  QA Orchestrator                             │
│                                              │
│  1. Provision test user + reset state        │
│  2. Dispatch to sub-agents in parallel       │
│  3. Collect results                          │
│  4. Run synthesis agent                      │
│  5. Emit report                              │
└──────────────┬───────────────────────────────┘
               │
       ┌───────┴────────┐
       ▼                ▼
┌─────────────┐  ┌──────────────────┐
│  Contract   │  │  Adversarial     │
│  Runner     │  │  Prober          │
│             │  │                  │
│  Executes   │  │  Executes        │
│  scenario   │  │  probe library   │
│  library    │  │  against live    │
│  step by    │  │  server          │
│  step       │  │                  │
│  Compares   │  │  Asserts error   │
│  to oracle  │  │  shape and       │
│             │  │  resolution      │
└──────┬──────┘  └───────┬──────────┘
       │                 │
       └────────┬────────┘
                ▼
       ┌────────────────┐
       │  Synthesis     │
       │  Agent         │
       │                │
       │  - Surfaces    │
       │    anomalies   │
       │  - Identifies  │
       │    coverage    │
       │    gaps        │
       │  - Asks what   │
       │    isn't       │
       │    tested      │
       └────────┬───────┘
                ▼
           QA Report
```

### Synthesis agent prompt

The synthesis agent reads all tool call traces and assertion results and answers:

```
You are an adversarial QA engineer reviewing the output of an automated test run
against a headless MCP server.

Given:
- The tool call trace (every call, args, and response)
- The assertion results (pass/fail with messages)
- The coverage table (which entity types are covered by which tools)

Your job:
1. Identify any silent failures — tool calls that returned 200 but the data is wrong
2. Identify coverage gaps — entity types or tool pairs with no test
3. Ask three questions about system assumptions that no test currently verifies
4. Flag any error response that lacks a 'resolution' field

Do not summarize what passed. Focus on what failed, what is untested, and what
could fail that we haven't thought to test.
```

---

## What the Agent Can and Cannot Catch

| Category | Catchable | How |
|---|---|---|
| Normalization failures | Yes | Alias coverage property test |
| Write→read contract breaks | Yes | Contract test runner with oracle |
| Bypass list gaps | Yes | Membership assertion (unit, no server needed) |
| Silent 200 with wrong data | Yes | Tracing + oracle comparison |
| State not reset between tests | Yes | Idempotency probe (run twice, assert same result) |
| Safety gate not blocking writes | Yes | Adversarial probe PROBE-01 |
| Safety gate blocking reads | Yes | Adversarial probe PROBE-02 |
| Token replay | Yes | Adversarial probe PROBE-04 |
| New alias from new integration | Only if added to probe library | |
| Semantic logic bugs (domain errors) | Only if oracle defines correct answer | |
| Novel failure modes never seen before | No — still needs humans or prod signals | |

The honest ceiling: the agent tests what you've written down. It cannot discover
new categories of failure. When production or manual QA surfaces a new failure mode,
add it to the probe library. It becomes automated from that point forward.

---

## The Discovery Loop

This is how the system improves over time:

```
New failure found                    Add to probe library
(prod signal / manual QA)  ───────►  and scenario library
         ▲                                    │
         │                                    ▼
         │                          Agent runs it on
         │                          every PR going forward
         │                                    │
         └────── Regression caught ───────────┘
                 before it ships
```

The agent does not replace human discovery. It ensures that once a failure mode is
discovered, it is never silently reintroduced.

---

## Implementation Order

Build in this order. Each step is independently useful.

### Step 1 — Bypass list and normalization unit tests (no server needed)

These are pure unit tests. No environment required. Run in CI on every commit.

```typescript
// tests/qa/unit/bypassList.test.ts
import { GATE_EXEMPT } from '@/app/api/mcp/route';

const READ_TOOLS = ['get_workout_history', 'get_readiness', 'get_fitness_snapshot'];
const WRITE_TOOLS = ['log_workout', 'log_health_screenshot', 'delete_workout'];

it('all read tools bypass the gate', () => {
  for (const tool of READ_TOOLS) {
    expect(GATE_EXEMPT.has(tool)).toBe(true);
  }
});

it('no write tools bypass the gate', () => {
  for (const tool of WRITE_TOOLS) {
    expect(GATE_EXEMPT.has(tool)).toBe(false);
  }
});
```

```typescript
// tests/qa/unit/normalization.test.ts
import { normalizeType } from '@stryde/domain-contracts';
import { ALL_KNOWN_ALIASES } from '../fixtures/aliases';

it('every known alias normalizes to non-null', () => {
  for (const alias of ALL_KNOWN_ALIASES) {
    expect(normalizeType(alias)).not.toBeNull();
  }
});

it('normalization is idempotent', () => {
  for (const alias of ALL_KNOWN_ALIASES) {
    const once = normalizeType(alias);
    if (once) expect(normalizeType(once)).toBe(once);
  }
});
```

### Step 2 — Test environment setup

- Provision a test user ID in the staging environment
- Write a `resetTestUser(userId)` function that deletes all records for that user
- Write a `callTool(name, args, userId)` helper that calls the live server
- Add env vars: `QA_TEST_USER_ID`, `QA_SERVER_URL`, `QA_API_KEY`

### Step 3 — Contract test runner

Convert the top 5 scenarios from `E2E_TEST_SCENARIOS.md` to structured fixtures.
Write the runner that executes them and compares to the oracle.
Wire into CI as a separate job that runs against staging.

Start with the highest-value contracts:
- HRV write → query_metric read (C-H1)
- Pain signal → write blocked (PROBE-01)
- Pain signal → read passes (PROBE-02)
- Sleep write → readiness updated
- Workout write → workout history read

### Step 4 — Adversarial probe runner

Add the probe library. Run it nightly or pre-release (it's slower than unit tests).

### Step 5 — Synthesis agent

Add the synthesis agent as a post-run step. It reads the trace log and reports
anomalies, coverage gaps, and questions.

### Step 6 — Coverage table enforcement

The coverage table in `STABILITY_ARCHITECTURE.md` lists which entity types are
covered by which tools. Write a test that reads this table and asserts a contract
test exists for every non-gap cell. New tools added without a contract test fail CI.

---

## What to Add to CLAUDE.md

For the QA agent's outputs to be acted on by future code review sessions, add this
to `CLAUDE.md`:

```markdown
## MCP Tool Code Review

Before approving any change to MCP tools, storage functions, or route handlers:

1. Check `HEADLESS_MCP_ENGINEERING_GUIDE.md` — server-side patterns
2. Check `LLM_AS_UI_PATTERNS.md` — LLM client failure modes
3. Verify: does this change require a new entry in the scenario library?
4. Verify: does this change require a new entry in the probe library?
5. Verify: does this change affect the coverage table in STABILITY_ARCHITECTURE.md?

If any of the above is yes, the PR is incomplete without the corresponding test or
table update.
```

---

## The Honest Assessment

This agent raises the floor significantly. It catches regressions on known invariants
before they reach production. It does this reliably, cheaply, and without fatigue.

It does not raise the ceiling. Unknown failure modes — the things that would have
surprised us even with this agent running — still require human judgment, production
signals, or explicit exploration. When they appear, the loop is: discover, add to
library, automate. The agent then owns them permanently.

The gap between "catches known invariants" and "catches everything" is not closeable
by adding more tests. It requires someone asking "what are we not testing and why?"
on a regular cadence. That question is cheap when the agent handles the mechanical
verification and expensive when humans are spending time re-running known scenarios.

The value of this agent is not that it catches everything. It is that it frees humans
to focus on the things it cannot catch.

---

*Written 2026-05-20. For the Stryde MCP server but applicable to any headless MCP server
that ingests external data, applies domain logic, and serves LLM clients.*
