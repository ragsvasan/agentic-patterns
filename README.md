# agentic-patterns

Engineering patterns and an adversarial QA framework for headless MCP servers.
Domain-agnostic — works for any project where an LLM is the client.

## What's Here

```
docs/
  HEADLESS_MCP_ENGINEERING_GUIDE.md   Server-side design patterns
  LLM_AS_UI_PATTERNS.md               LLM client failure modes
  QA_AGENT_DESIGN.md                  Adversarial QA agent design brief

qa-framework/
  src/
    types.ts       QAScenario, QAProbe, QAReport — core interfaces
    tracer.ts      Tool call tracer + HTTP caller for live MCP servers
    runner.ts      QARunner — executes scenarios and probes, emits report
    synthesis.ts   Builds the synthesis agent prompt for adversarial analysis
    index.ts       Public exports

templates/
  scenarios.template.ts        Fill in for your project's write→read contracts
  probes.template.ts           Fill in for your project's adversarial probes
  aliases.template.ts          Fill in for your project's external aliases
  runner.entrypoint.template.ts  Entry point for running the QA suite
  claude-md-addition.md        Paste into your project's CLAUDE.md
```

## How to Use in a New Project

**Step 1 — Reference the docs in CLAUDE.md**

Copy the contents of `templates/claude-md-addition.md` into your project's `CLAUDE.md`.
Update paths to point at the shared docs. This makes Claude Code apply the patterns
automatically on every relevant review.

**Step 2 — Add the framework as a dependency**

```json
// your project's package.json
{
  "devDependencies": {
    "agentic-patterns": "path:../agentic-patterns"
  }
}
```

Or reference via git if it's in its own repo:
```json
"agentic-patterns": "github:your-org/agentic-patterns"
```

**Step 3 — Create your project's fixtures**

Copy the templates to `tests/qa/fixtures/` in your project:

```
cp templates/scenarios.template.ts  your-project/tests/qa/fixtures/scenarios.ts
cp templates/probes.template.ts     your-project/tests/qa/fixtures/probes.ts
cp templates/aliases.template.ts    your-project/tests/qa/fixtures/aliases.ts
cp templates/runner.entrypoint.template.ts  your-project/tests/qa/run.ts
```

Fill in tool names, args, and assertions specific to your project.

**Step 4 — Write unit tests (no server needed)**

```typescript
// tests/qa/unit/normalization.test.ts
import { normalizeType } from '@your-project/domain-contracts';
import { ALL_KNOWN_ALIASES } from '../fixtures/aliases';

it('every known alias normalizes to non-null', () => {
  for (const alias of ALL_KNOWN_ALIASES) {
    expect(normalizeType(alias)).not.toBeNull();
  }
});
```

```typescript
// tests/qa/unit/bypassList.test.ts
import { GATE_EXEMPT } from '@your-project/route';

it('read tools bypass the gate', () => {
  expect(GATE_EXEMPT.has('get_entity')).toBe(true);
});

it('write tools do not bypass the gate', () => {
  expect(GATE_EXEMPT.has('create_entity')).toBe(false);
});
```

**Step 5 — Run the integration suite**

```bash
QA_SERVER_URL=https://staging.example.com \
QA_TEST_USER_ID=test-user-001 \
QA_API_KEY=sk-test-... \
npx tsx tests/qa/run.ts
```

**Step 6 — Feed the synthesis prompt to Claude**

The runner prints a synthesis prompt at the end. Paste it into Claude to get
adversarial analysis: silent failures, coverage gaps, untested assumptions.

## The Discovery Loop

```
New failure found              Add to fixtures
(prod / manual QA)  ────────►  (scenarios.ts or probes.ts)
       ▲                                │
       │                                ▼
       │                     Agent catches it on
       │                     every PR going forward
       └────── Regression prevented ────┘
```

The framework tests what you've written down. When production surfaces a new failure
mode, add it to the fixtures — it becomes automated from that point forward.

## Projects Using This

- Add yours here (open a PR)

## What This Does Not Do

- It cannot discover failure modes you haven't written down
- It does not replace humans asking "what are we not testing?"
- Synthesis agent analysis is probabilistic — it may miss things

The value is freeing humans from re-running known scenarios so they can focus on
the things this framework cannot catch.
