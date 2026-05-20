# CLAUDE.md addition — paste into your project's CLAUDE.md

Add this section to make Claude Code apply these patterns automatically on every
relevant code review or implementation task.

---

## MCP Tool Engineering

This project uses a headless MCP server with an LLM client. Before writing or
reviewing any MCP tool, storage function, or route handler, read:

- `[path-to]/HEADLESS_MCP_ENGINEERING_GUIDE.md` — server-side patterns
- `[path-to]/LLM_AS_UI_PATTERNS.md` — LLM client failure modes

### On every code review of MCP-related changes, verify:

**Normalization**
- [ ] Every storage function calls `normalizeType()` before writing to DB
- [ ] No read path re-normalizes (if it does, the write path is broken)
- [ ] Unknown types emit a WARN log — never silently drop or store raw

**Safety gate**
- [ ] `GATE_EXEMPT` set is defined at module scope, not inside request handler
- [ ] New read tools are added to `GATE_EXEMPT`
- [ ] New write tools are NOT in `GATE_EXEMPT`

**Write→read contracts**
- [ ] Every new write tool has a contract test in `tests/qa/fixtures/scenarios.ts`
- [ ] Contract tests hit real storage — no mocked DB

**Tool descriptions**
- [ ] Description states precondition ("call this before X")
- [ ] Description distinguishes from similar tools
- [ ] No deprecation notices in descriptions of live tools

**Error responses**
- [ ] Validation errors include a `resolution` field
- [ ] Deprecation errors are structured (`TOOL_DEPRECATED` code + `replacement` field)
- [ ] No unstructured 500s reachable from valid tool inputs

**Coverage table**
- [ ] New entity types added to coverage table in `STABILITY_ARCHITECTURE.md`
- [ ] Gaps are explicit (`—`), not missing from the table

### On every new data source integration, verify:

- [ ] All aliases from the new source added to `tests/qa/fixtures/aliases.ts`
- [ ] All aliases added to `EXTERNAL_TO_CANONICAL_MAP` in domain-contracts
- [ ] Alias coverage test passes: `pnpm test -- normalization`
