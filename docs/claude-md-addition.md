# CLAUDE.md Addition — MCP Agent Engineering Patterns

Paste this into every project's CLAUDE.md that uses a headless MCP server.
Update the paths to point at your agentic-patterns repo location.

---

## MCP Agent Engineering

This project uses a headless MCP server with an LLM client.
Research-backed patterns apply to every tool, description, and error response.
Full pattern catalogue: `~/agentic-patterns/docs/RESEARCH_PATTERNS.md`

### On every MCP tool you write or review, check all of the following:

**Tool response shape**
- [ ] Primary value (score, id, status) is at the TOP LEVEL — not nested
- [ ] Write tools return the full written record, not a confirmation string
- [ ] Read tools include `fetchedAt` and `dataFreshnessTtlSeconds`
- [ ] Response follows the shared envelope: `{ data, fetchedAt, suggestedTools?, warnings? }`

**Tool description**
- [ ] Starts with a verb ("Fetches...", "Logs...", "Returns...")
- [ ] States WHEN to call it (precondition)
- [ ] States what NOT to use it for (disambiguation from similar tools)
- [ ] No deprecation notices in descriptions of live tools

**Parameters**
- [ ] No single-word names for domain concepts (`userId` not `id`, `activityType` not `type`)
- [ ] Every parameter has a `.describe()` string with an example value
- [ ] Required vs optional is unambiguous — optional params state their default

**Error responses**
- [ ] Every error includes `error` (code), `message`, and `resolution`
- [ ] Prerequisite errors name the tool to call and the param to pass back
- [ ] No unstructured error strings (`"Invalid input"` alone is not acceptable)

**Security**
- [ ] `GATE_EXEMPT` is defined at module scope, not inside the request handler
- [ ] Any tool returning external/user-generated content wraps it with `__type: "user_content"`
- [ ] New read tools are added to `GATE_EXEMPT`; write tools are never added

**Context budget**
- [ ] Tool response returns only what the agent needs for the next step
- [ ] `suggestedTools` is present when the response implies a next action

### On every system prompt you write or review:
- [ ] Behavioral constraints are in the first 500 tokens (not buried)
- [ ] Includes: "A value from context history is a memory, not a measurement. Re-fetch if fetchedAt > dataFreshnessTtlSeconds."
- [ ] Includes: "suggestedTools are required next calls — treat as a function queue."

### On any new data source integration:
- [ ] All aliases from the new source added to `tests/qa/fixtures/aliases.ts`
- [ ] All aliases added to `EXTERNAL_TO_CANONICAL_MAP`
- [ ] `pnpm test -- normalization` passes

### Retroactive audit:
Run `/audit-mcp` in any session to check existing code against all patterns above.
