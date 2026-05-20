# Headless MCP Server — Engineering Guide

Design and test patterns for MCP servers that ingest external data, apply domain
logic, and serve AI agents. These patterns apply to any domain: health, finance,
logistics, CRM. The examples use a fitness context but the structure is domain-agnostic.

---

## Part 1 — What Should Have Been Day 1 vs What You Discover

Be honest about which category a bug falls into before you fix it.

**Architecture gaps** — you knew the category of problem existed before writing code:
- You had external aliases → you knew you needed canonical names
- You had a safety gate → you knew you needed a bypass list
- You had write tools → you knew you needed read tools to verify them

**Legitimate discovery** — you genuinely couldn't know this without usage data:
- The full set of values users send for a free-text field
- Which integrations users actually connect
- Where the domain thresholds should sit (what counts as "too much load")
- Which entity types your initial enum is missing

The test: "Did we know this *category* of problem existed before we wrote the code?"
If yes, it's an architecture gap. Architecture gaps are preventable. Discovery bugs are not.

In practice, roughly 60% of data pipeline bugs in MCP servers are architecture gaps.
The other 40% require real usage to surface.

---

## Part 2 — Design Patterns

### Pattern 1 — Boundary normalization

**Problem:** External sources use different names for the same concept.
Apple Health calls it `HKQuantityTypeIdentifierHeartRate`. Garmin calls it `GARMIN_HEART_RATE`.
Your MCP tool accepts `heart_rate`. Your DB stores `HR`. Unless you normalize at one point,
every consumer must normalize independently — and one will forget.

**Rule: normalize at write time. Trust canonical at read time. Never re-normalize.**

```
External input → [normalize()] → CanonicalId → DB write
                                                    ↓
                                  DB read → canonical values → all consumers
```

If a read path needs to normalize, the write path has a bug.

**Implementation:**

```typescript
// shared package — written before any storage code

export const ENTITY_TYPES = {
  TYPE_A: 'A',
  TYPE_B: 'B',
  TYPE_C: 'C',
} as const;

export type EntityType = (typeof ENTITY_TYPES)[keyof typeof ENTITY_TYPES];

const ALIAS_MAP: Record<string, EntityType> = {
  // source 1 names
  EXTERNAL_SOURCE_1_TYPE_A: ENTITY_TYPES.TYPE_A,
  // source 2 names
  EXTERNAL_SOURCE_2_TYPE_A: ENTITY_TYPES.TYPE_A,
  // tool input aliases
  type_a: ENTITY_TYPES.TYPE_A,
  typeA: ENTITY_TYPES.TYPE_A,
  // canonical form maps to itself
  A: ENTITY_TYPES.TYPE_A,
} as const;

export function normalizeType(raw: string | null | undefined): EntityType | null {
  if (!raw) return null;
  const key = raw.toUpperCase().replace(/[^A-Z0-9_]/g, '');
  return ALIAS_MAP[key] ?? null;
}
```

Then brand the DB column so the compiler enforces it:

```typescript
// Drizzle ORM
entityType: text('entity_type').$type<EntityType>().notNull(),
```

Now it is a compile error to write a raw string to that column.

**When normalization produces null** (unknown type):
- Emit a `WARN` log with the raw value — do not silently drop or store raw
- This surfaces new integration types before users report broken queries

```typescript
const canonical = normalizeType(input.type);
if (!canonical) {
  logger.warn('unknown_entity_type_stored_raw', { raw: input.type, toolName });
}
const typeToStore = canonical ?? input.type; // fallback with visibility
```

---

### Pattern 2 — Safety gate as pure function with module-scope bypass list

**Problem:** An MCP server with a gate (block writes when a condition is active) needs
some tools to bypass the gate. If the bypass list is built inside the request handler,
it is rebuilt on every request and the decision that the list represents is hidden in
runtime code rather than expressed at the module boundary.

**Rule: bypass lists are compile-time decisions. Define them at module scope.**

```typescript
// module scope — allocated once at startup
const GATE_EXEMPT = new Set<string>([
  'get_item',
  'list_items',
  'get_status',
  'resolve_condition',   // safety management — must always be accessible
  'get_diagnostics',
]);

const SECONDARY_GATE_EXEMPT = new Set<string>([
  'get_item',
  'list_items',
]);

export async function POST(req: Request) {
  const { tool } = parseRequest(req);

  if (!GATE_EXEMPT.has(tool)) {
    const gate = await evaluateGate(userId, db);
    if (gate.blocked) return gateResponse(gate);
  }
  // ...
}
```

**Rule: gate evaluation is a pure function of a state value.**

Load the state in parallel, evaluate without async:

```typescript
interface GateState {
  activeConditions: Condition[];
  recentMetrics: MetricReading[];
  // ... whatever the gate needs
}

// pure — no async, no DB, fully testable
function evaluateGate(state: GateState): GateResult {
  if (state.activeConditions.some(c => !c.resolved)) {
    return { blocked: true, reason: 'ACTIVE_CONDITION', message: '...' };
  }
  // ... other rules
  return { blocked: false };
}

// loader — called once per request, runs queries in parallel
async function loadGateState(userId: string, db: DB): Promise<GateState> {
  const [conditions, metrics] = await Promise.all([
    db.query.conditions.findMany({ where: eq(conditions.userId, userId) }),
    db.query.metrics.findMany({ where: eq(metrics.userId, userId) }),
  ]);
  return { activeConditions: conditions, recentMetrics: metrics };
}
```

**Why pure matters:** Every gate rule can be unit-tested with no DB, no network.
You can test rule combinations, edge cases, and boundary values in milliseconds.

---

### Pattern 3 — Write→read contract tests

**Problem:** A tool writes to the DB. A different tool reads from the DB.
The contract between them is implicit — until one breaks.

**Rule: every write tool has a corresponding contract test that calls the read tool.**

```typescript
it('create_item → get_item round-trip', async () => {
  const { id } = await callTool('create_item', {
    type: 'TYPE_A',
    value: 42,
    confirmed: true,
  });

  const result = await callTool('get_item', { id });

  expect(result.type).toBe('TYPE_A');  // canonical — not the raw alias
  expect(result.value).toBe(42);
});
```

Do not mock the DB in contract tests. A contract test that mocks storage tests nothing
except that your mock agrees with itself.

**For tools that write to multiple tables**, assert both:

```typescript
it('create_item → updates both tables', async () => {
  await callTool('create_item', { ... });

  const item = await callTool('get_item', { id });
  expect(item).toBeDefined();

  const summary = await callTool('get_summary', { days: 1 });
  expect(summary.count).toBe(1);  // second table must also be updated
});
```

If you only test one table, the other can silently fail in production.

---

### Pattern 4 — Explicit entity type coverage table

**Problem:** You build support for the common cases. Edge cases appear when users arrive.
Without a coverage table, gaps are invisible.

**Rule: maintain a coverage table. Gaps are explicit, not hidden.**

| Entity type | create tool | read tool | summary tool | load accounting | Analytics |
|---|---|---|---|---|---|
| TYPE_A | ✓ | ✓ | ✓ | ✓ | ✓ |
| TYPE_B | ✓ | ✓ | ✓ | — | — |
| TYPE_C | — | ✓ | — | — | — |
| TYPE_D | — | — | — | — | — |

Every `—` is a known gap. Known gaps are tracked. Unknown gaps are bugs.

When you add a new entity type to one tool, scan the table. File issues for the gaps.
When you add a new tool, add a column to the table.

---

### Pattern 5 — Two-stage commit for destructive writes

**Problem:** AI agents make mistakes. A tool that deletes or overwrites data without
confirmation can cause data loss that the user didn't intend.

**Rule: destructive tools require two calls. First call previews. Second call executes.**

```typescript
// First call — no confirmation
callTool('delete_item', { id: '123' })
// → returns: { preview: 'Will delete: Item A (created 2026-01-01)', confirmed: false }

// Second call — with confirmation
callTool('delete_item', { id: '123', confirmed: true })
// → returns: { deleted: true }
```

Implement via a `CONFIRMATION_REQUIRED` error code in the dispatcher:

```typescript
if (requiresConfirmation(tool) && !args.confirmed) {
  return {
    jsonrpc: '2.0',
    error: {
      code: -32003,
      message: 'CONFIRMATION_REQUIRED',
      data: { preview: buildPreview(tool, args) },
    },
  };
}
```

The agent learns to call twice. The user sees what will happen before it happens.

---

## Part 3 — Test Patterns

### Three test types and when to use each

**Property tests** — for pure functions with invariants

Use when the function has mathematical properties that hold for all inputs.
Don't test one example. Test the property.

```typescript
import fc from 'fast-check';

// BAD: example test
it('normalizes type_a', () => {
  expect(normalizeType('type_a')).toBe('A');
});

// GOOD: property test — fails the moment any alias is missing
it('every known alias normalizes to a non-null canonical type', () => {
  fc.assert(fc.property(
    fc.constantFrom(...ALL_KNOWN_ALIASES),
    (alias) => normalizeType(alias) !== null
  ));
});
```

Properties worth testing for any normalization system:
- **Totality**: every alias in every known format returns non-null
- **Surjectivity**: every canonical type is reachable from at least one alias  
- **Idempotency**: normalizing a canonical value returns the same canonical value
- **Case insensitivity**: `type_a` = `TYPE_A` = `Type_A` if your normalizer uppercases

**Contract tests** — for write→read boundaries

Use when a write operation must produce a readable result.
One test per (write tool, read tool) pair. Must hit real storage.

**Scenario tests** — for multi-step agent workflows

Use when testing that a complete workflow produces the right outcome.
Keep sparse — expensive to write, expensive to maintain.

Canonical scenario set (covers ~80% of real agent interactions for most domains):
1. Create entity → read entity → values match
2. Create entity → list entities → appears in list
3. Activate condition → write tool blocked → resolve condition → write tool unblocked
4. Create entities over time → summary tool → aggregation correct
5. Delete entity → entity no longer appears in reads

Everything beyond this is a contract test.

---

### Alias coverage test pattern

Maintain a single source-of-truth list of all external aliases:

```typescript
// test/fixtures/aliases.ts
export const ALL_KNOWN_ALIASES = [
  // Source 1 format
  'SOURCE_1_TYPE_A',
  'SOURCE_1_TYPE_B',
  // Source 2 format
  'SOURCE_2_TYPE_A',
  // Tool input aliases
  'type_a', 'typeA', 'type-a',
  // Canonical forms (idempotency)
  'A', 'B', 'C',
] as const;
```

Then one test in CI:

```typescript
it('every known alias resolves to a canonical type', () => {
  for (const alias of ALL_KNOWN_ALIASES) {
    expect(normalizeType(alias)).not.toBeNull();
  }
});
```

This test fails the moment you integrate a new data source and forget to add its aliases.
It is the cheapest possible protection for one of the most common bugs.

---

### Gate bypass coverage test pattern

Two-sided: test that reads are in the exempt list and writes are not.

```typescript
const READ_TOOLS = ['get_item', 'list_items', 'get_summary'];
const WRITE_TOOLS = ['create_item', 'delete_item', 'update_item'];

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

Run as unit tests on every commit. No DB required.

---

### Gate rule unit test pattern

Because the gate is a pure function, every rule is independently testable:

```typescript
it('blocks when an unresolved condition exists', () => {
  const state: GateState = {
    activeConditions: [{ id: '1', resolved: false, createdAt: new Date() }],
    recentMetrics: [],
  };
  expect(evaluateGate(state).blocked).toBe(true);
});

it('does not block when all conditions are resolved', () => {
  const state: GateState = {
    activeConditions: [{ id: '1', resolved: true, createdAt: new Date() }],
    recentMetrics: [],
  };
  expect(evaluateGate(state).blocked).toBe(false);
});

it('first blocking rule wins', () => {
  // Both rules would block — verify the right one is returned
  const state = buildStateWhereMultipleRulesWouldBlock();
  expect(evaluateGate(state).reason).toBe('FIRST_RULE');
});
```

No mocking, no fixtures, no DB. These tests run in microseconds.

---

## Part 4 — Starting a New Headless MCP Server

Do these in order. Do not skip steps.

**Step 0 — Define canonical types before any storage code**

Write your entity type constants, alias map, and normalizer in a shared package.
Write the alias coverage test. Do not write a storage function until this exists.

**Step 1 — Define DB schema with branded types**

Use your ORM's type-branding feature on every column that stores an entity type.
This makes it a compile error to store a raw string.

**Step 2 — Write the gate as a pure function**

Write the state type, the evaluator, and the loader as separate concerns.
Write unit tests for the evaluator before implementing any rule.
Define the bypass list at module scope with its two-sided test.

**Step 3 — Write the first write tool and its contract test simultaneously**

The contract test is not written after the tool ships. It is written with the tool.
If you cannot write the contract test, the tool interface is not fully defined yet.

**Step 4 — Maintain the entity type coverage table**

Start it on day 1 with whatever types you support. Every new type or tool updates the table.
Gaps are explicit, not discovered in production.

**Step 5 — Add the alias coverage test to CI**

It runs on every commit. When a new source integration is added, the developer adds
its aliases to the fixture and to the map. The test enforces this.

---

## Part 5 — Code Review Red Flags

Signs that the above patterns are not being followed:

- **A raw string used as a DB query filter** instead of a typed constant
- **A bypass list or config object inside a request handler** — these are compile-time decisions
- **A storage function that does not call the normalizer** before writing
- **A contract test that mocks the DB** — contract tests must hit real storage
- **A new entity type added to one tool** without a coverage table update
- **`any[]` cast on DB query results** — type the result or use a Zod schema
- **Sequential `await` calls in a loader** where `Promise.all` would work
- **A gate rule that queries using raw strings** instead of typed constants
- **A `switch` on a union type without an exhaustive `default`** — add `const _: never = val`

---

## Part 6 — TypeScript Defaults for MCP Servers

These apply regardless of domain:

**No `any`.** Use `unknown` and narrow with `instanceof`, `typeof`, or Zod `.parse()`.
`any` disables the type system at the exact spot it matters most.

**Exhaustive unions.** Every `switch` on a discriminated union gets a `default` branch:
```typescript
default: {
  const _: never = entityType;
  throw new Error(`unhandled entity type: ${entityType}`);
}
```
Unhandled variants are compile errors, not runtime surprises.

**Zod at the boundary.** Validate all MCP tool arguments with a Zod schema at the handler.
Never access `args.field` without parsing first.

**`Promise.all` by default.** If two `await`s don't depend on each other, run them in parallel.
Sequential independent awaits double latency.

**Typed errors.** `catch (e: unknown)`, narrow before use.
Never `catch (e: any)` or `(e as Error).message` without checking `instanceof Error` first.

**Auth first.** Call `auth()` as the first line of every route handler.
Never reach storage code before auth is confirmed.

---

## Part 7 — The Honest Assessment

These patterns are not novel. They are standard software engineering applied to MCP servers:
- Discriminated unions for string constants (any TypeScript project)
- Normalization at the write boundary (any system with external aliases)
- Module-scope constants for per-request sets (any server)
- Round-trip tests for write→read (any CRUD system)
- Pure functions for stateful logic (any tested system)

If these patterns are missing from a running system, the cost of adding them retroactively is:
1. Audit every storage call for missing normalization
2. Backfill existing DB rows to canonical values before adding type enforcement
3. Write contract tests for tools that already exist

The backfill (step 2) is the expensive one. Non-canonical rows silently become invisible
when type branding is added. A migration must run before the type constraint lands in production.

The earlier these decisions are made, the lower the cost. The patterns are not complex.
The difficulty is recognizing that they are needed before the first storage function is written.
