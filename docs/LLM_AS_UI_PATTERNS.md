# LLM as UI — Engineering Patterns

A companion to the headless MCP server guide. The server-side patterns (normalization,
contracts, gate logic) assume a deterministic client. An LLM client is not deterministic.
This document covers the failure modes that are unique to that.

---

## What Is Different

A traditional API client is deterministic. It calls endpoints in an order defined by
application code. Errors are caught by catch blocks. Schema validation happens before
business logic. State is maintained by the client application.

An LLM client is none of these things:
- Tool call order emerges from text understanding, not application code
- Errors are "handled" by the LLM deciding what to do next based on the error *text*
- Schema compliance depends on the LLM understanding the description of the schema
- State is reconstructed from tool calls each session — there is no persistent client state
- Deprecated tools can't be removed by updating client code — the model may have learned them

This changes what the server must do.

---

## Failure Mode 1 — Context drift: the LLM uses a stale value

**What happens:** The LLM calls `get_readiness` at turn 3 and sees a score of 72.
At turn 15, after the user has logged new data, the LLM still "knows" the score is 72
because the earlier tool result is still in context. It answers from memory, not from data.

This is different from a bug — the LLM is doing exactly what you'd expect from a
language model. The problem is architectural: the system allows authoritative values
to come from context rather than from tool calls.

**What this looks like in production:** The LLM makes a training recommendation based
on a readiness score from two hours ago. The user logged a bad HRV after that.
The recommendation is wrong. The data was correct when fetched.

**Mitigations:**

*Make key tools cheap enough to re-call.* If `get_readiness` takes 800ms, the LLM
will avoid calling it again. If it takes 50ms, re-calling is the path of least resistance.

*Include a `fetchedAt` timestamp in every result.* The LLM can reason "this was fetched
3 turns ago — I should re-fetch before acting." Without the timestamp, it cannot.

```json
{
  "readinessScore": 72,
  "fetchedAt": "2026-05-19T09:14:22Z",
  "dataFreshnessTtlSeconds": 300
}
```

*Use `suggestedTools` as a required call queue, not a suggestion.* If your tool result
says "call `get_readiness` before making a training recommendation," treat that as
a system-level constraint in the system prompt, not advice.

*System prompt: "A value seen in conversation history is a memory, not a measurement.
Before any recommendation, re-call the relevant tool."*

---

## Failure Mode 2 — Non-deterministic tool call order

**What happens:** Your tools are designed assuming a sequence:
`get_user_context` → `get_fitness_snapshot` → `make_recommendation`.
The LLM calls `make_recommendation` first.

**What this looks like in production:** Tool A depends on data from tool B.
The LLM calls A without B. A returns a result based on defaults or missing data.
No error is raised because the tool didn't fail — it just used incomplete context.

**Mitigations:**

*Make tools self-sufficient.* If `make_recommendation` needs user context, fetch it
internally rather than relying on the LLM to have called `get_user_context` first.
Tools that require prerequisites are fragile in an LLM context.

*If a prerequisite call is genuinely required, enforce it:*
```typescript
if (!args.userContextToken) {
  return {
    error: 'PREREQUISITE_REQUIRED',
    message: 'Call get_user_context first and pass the returned token here.',
    suggestedTools: ['get_user_context'],
  };
}
```

*Document the dependency in the tool description, not in external documentation.*
The tool description is the only contract the LLM reads at the moment of the call.

---

## Failure Mode 3 — Hallucinated parameter values

**What happens:** A tool has a required parameter the LLM doesn't know the value of.
In a traditional form UI, the field would be blank and submission would fail.
An LLM will invent a plausible-looking value and submit it.

**What this looks like in production:** `log_item` requires an `itemId`. The LLM
doesn't have the ID in context (it fell out of the context window). It generates
a UUID that looks valid. The tool writes to the wrong record or creates a ghost record.

**Mitigations:**

*Prefer opaque tokens over user-readable IDs.* If the LLM must pass back a value
the server gave it, make the value clearly server-generated and short-lived:
```json
{ "sessionToken": "sess_a3f9", "expiresIn": 300 }
```
A hallucinated `sess_a3f9` value is easier to validate than a hallucinated UUID.

*Return the full written record in every write response.* If the LLM can see what
was written, it can verify it matches intent before the user sees output.

*Validate correlated parameters.* If `date` and `sessionId` must refer to the same
event, verify that server-side. The LLM will not catch mismatches between parameters
it assembled from different parts of context.

---

## Failure Mode 4 — Tool descriptions are load-bearing, not cosmetic

**What happens:** In a traditional UI, a button label is cosmetic — the behavior is
determined by the code behind the button. In an LLM UI, the tool description *is*
the interface contract. The LLM decides when and how to call a tool based entirely
on its description.

A vague description causes systematic misuse. A misleading description causes
systematic misuse in a consistent direction, which is harder to debug.

**What this looks like in production:**
- `get_fitness_summary` is described as "returns a fitness summary." The LLM calls it
  when it should call `get_fitness_snapshot`. Both seem like summaries.
- `log_item` says "logs an item." The LLM doesn't know whether to call it before or
  after `get_item`. It picks one. Sometimes it picks wrong.

**Rules for tool descriptions:**

*State the precondition.* "Call this before making any training recommendation."
Not "Returns current training recommendations."

*State what NOT to use it for.* If two tools have similar names, distinguish them
explicitly: "Use this for current scores. For historical trends, use `get_item_trend`."

*Make the description prescriptive, not descriptive.* The description controls LLM
behavior. Write it like a directive, not a label.

*Never embed a deprecation notice in the description of a live tool.*
If `get_week_summary` is not deprecated, don't say it is. The LLM will avoid it.
If it is deprecated, remove it — don't warn about it.

---

## Failure Mode 5 — Deprecated tools are hard to sunset

**What happens:** You rename a tool from `get_fitness_summary` to `get_fitness_snapshot`.
You mark the old one deprecated and add a notice to its description. The LLM keeps
calling the old name because:
- It learned the old name from training data or earlier in this session
- The tool still works — it just returns a deprecation notice
- The LLM sees the notice, acknowledges it, and calls the deprecated tool again next turn

A deprecation notice in a tool *response* teaches the LLM that the tool works.
It does not teach the LLM to stop using it.

**Mitigations:**

*Return a structured error, not a deprecation notice in the response body:*
```json
{
  "jsonrpc": "2.0",
  "error": {
    "code": -32601,
    "message": "TOOL_DEPRECATED",
    "data": {
      "deprecated": "get_fitness_summary",
      "replacement": "get_fitness_snapshot",
      "reason": "get_fitness_snapshot returns the same data with richer context"
    }
  }
}
```

An error forces the LLM to switch. A warning in the body does not.

*Remove the deprecated tool from the manifest as soon as feasible.*
If it's not in the manifest, the LLM can't call it.

---

## Failure Mode 6 — Two-stage commit under non-determinism

**What happens:** Your destructive tools require `confirmed: true` on the second call.
An LLM may:
- Send `confirmed: true` on the first call (skips the preview)
- Never send the second call (waits for user input that never comes)
- Send the second call for the wrong entity (assembled from stale context)

**Mitigations:**

*Include a server-generated confirmation token, not just a boolean:*
```json
// First call response
{ "preview": "...", "confirmationToken": "conf_x7k2", "expiresIn": 60 }

// Second call
callTool('delete_item', { confirmationToken: "conf_x7k2" })
```

The token is server-issued, short-lived, and cryptographically scoped to the specific
operation. The LLM can't assemble it from context — it must use what the server returned.
A hallucinated or replayed token is rejected.

*Make the first call response unambiguous about what will happen:*
```json
{
  "preview": "Will permanently delete: Item A (ID: 123, created 2026-01-01). This cannot be undone.",
  "confirmationToken": "conf_x7k2",
  "expiresIn": 60
}
```

The LLM reads this to the user. The user confirms. The LLM passes the token.
The operation is scoped and time-limited.

---

## Failure Mode 7 — Error messages must be actionable for an LLM

**What happens:** The server returns `{ "error": "Invalid request" }`. The LLM tells the
user "I encountered an error." It does not retry because it doesn't know how.

An LLM cannot reason about ambiguous errors. It will either stop, ask the user, or
make up a fix. All three are worse than a clear error message.

**Rule: every error must tell the LLM what to do next.**

```json
// BAD
{ "error": "Invalid metric type" }

// GOOD
{
  "error": "UNKNOWN_METRIC_TYPE",
  "message": "Metric type 'hrv_rmssd' is not recognized in this context.",
  "resolution": "Use metricType from the following set: HRV, RHR, HR, VO2MAX, WEIGHT",
  "suggestedTools": []
}
```

The LLM reads `resolution` and retries with a valid value. No user intervention needed.

*For prerequisite errors, name the tool to call first:*
```json
{
  "error": "PREREQUISITE_MISSING",
  "message": "User context is required before making a recommendation.",
  "resolution": "Call get_user_context and include the returned contextToken in this request.",
  "suggestedTools": ["get_user_context"]
}
```

---

## Failure Mode 8 — The LLM optimizes for plausible responses, not correct ones

**What happens:** When the LLM doesn't have enough data to answer confidently, it
produces a plausible-sounding response. This is a property of language models —
they are trained to produce fluent, contextually appropriate output.

In a coaching context: the user asks "how is my training going?" The LLM has a
readiness score of 72 and workout history from three days ago. It synthesizes:
"Your training is progressing well — your readiness is good and you've been consistent."
This may be completely wrong. The LLM has no way to know it's wrong.

**This is not a bug you can fix in the server.** It is a property of the client.

**Mitigations:**

*System prompt constraint: "Only state metrics when they come from a tool call in this
response. A value from conversation history is context, not measurement."*

*Include a staleness signal in responses.* If `get_readiness` returns `fetchedAt`
and the system prompt says "if fetchedAt is more than 10 minutes ago, re-fetch before
responding," the LLM will re-fetch. Without the signal, it cannot self-regulate.

*Make the tool result explicit about what it does and does not cover:*
```json
{
  "readinessScore": 72,
  "coversPeriod": "last 7 days",
  "missingData": ["sleep (no data in last 48h)", "HRV (last reading 5 days ago)"],
  "confidence": "partial"
}
```

The LLM can communicate uncertainty to the user when the data tells it to.

---

## What to Test That Standard Tests Miss

Standard contract tests verify that if you write X, you can read X.
They do not catch LLM-specific failure modes.

**LLM integration tests:**

```typescript
it('LLM calls get_readiness before making a recommendation', async () => {
  const calls: string[] = [];
  const trackedTools = wrapWithCallTracker(tools, calls);

  await runLLMSession(
    'What training should I do today?',
    trackedTools,
    { temperature: 0 }
  );

  expect(calls).toContain('get_readiness');
  expect(calls.indexOf('get_readiness')).toBeLessThan(
    calls.indexOf('recommend_session')
  );
});

it('LLM switches to replacement tool after deprecation error', async () => {
  const calls: string[] = [];
  await runLLMSession('Show me my fitness summary', wrapWithCallTracker(tools, calls), {
    temperature: 0,
  });

  expect(calls).not.toContain('get_fitness_summary');  // deprecated
  expect(calls).toContain('get_fitness_snapshot');      // replacement
});
```

Run these with `temperature: 0` for reproducibility. They will still not be 100%
deterministic across model versions — treat them as smoke tests, not unit tests.

---

## Summary of Rules

| Failure Mode | Server-side fix | System prompt fix |
|---|---|---|
| Context drift | Include `fetchedAt` in responses | "Re-fetch before acting" |
| Wrong call order | Make tools self-sufficient; return `PREREQUISITE_REQUIRED` | State call order in descriptions |
| Hallucinated parameters | Opaque server-issued tokens; validate correlated params | — |
| Vague tool descriptions | Rewrite descriptions as directives | — |
| Deprecated tools | Return structured `TOOL_DEPRECATED` error | — |
| Two-stage commit abuse | Server-issued confirmation tokens | — |
| Ambiguous errors | Actionable error messages with resolution | — |
| Plausible but wrong responses | `missingData` + `confidence` in results | "Only state values from this response's tool calls" |

The server-side fixes make the wrong behavior structurally harder.
The system prompt fixes constrain the LLM's reasoning.
Both are needed. Neither alone is sufficient.

---

*Written alongside the Stryde MCP server QA effort, 2026-05-19.
Domain examples use fitness context; patterns apply to any LLM-as-UI MCP server.*
