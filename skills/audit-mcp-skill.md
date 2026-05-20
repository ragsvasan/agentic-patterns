# `/audit-mcp` Skill Definition

Save this as `.claude/skills/audit-mcp.md` in your project (or in agentic-patterns
for shared use). When a session runs `/audit-mcp`, it executes this skill.

---

## Skill: audit-mcp

**Trigger:** `/audit-mcp [path]`

**Purpose:** Retroactive audit of existing MCP tool code against the research-backed
pattern catalogue. Produces a gap table with file + line references.

**The skill does NOT fix code — it audits and reports only.**

---

## Skill Instructions

You are auditing MCP tool code against 17 research-backed engineering patterns.
Do not fix anything. Read, assess, and report.

### Step 1 — Locate tool code

Find the following in the codebase:
- MCP tool manifest (tool names, descriptions, input schemas)
- MCP route handler (where GATE_EXEMPT / DRIFT_INTERCEPT_EXEMPT are defined)
- Tool handler functions (where responses are built)
- Error response construction sites
- System prompt strings

Use grep to find them efficiently:
```bash
grep -r "GATE_EXEMPT\|SAFETY_SHELL_EXEMPT" --include="*.ts" -l
grep -r "inputJsonSchema\|description:" apps/web/app/api/mcp/manifest.ts | head -60
grep -r "suggestedTools\|fetchedAt" --include="*.ts" -l
grep -r "resolution:" --include="*.ts" apps/web/app/api/mcp/
```

### Step 2 — Check each pattern

For each pattern, assess: PASS / FAIL / PARTIAL / UNKNOWN (can't determine without running)

| ID | Pattern | Status | File:Line | Fix needed |
|---|---|---|---|---|
| P-R1 | Primary value at top level of response | | | |
| P-R2 | Write tools return full written record | | | |
| P-R3 | Read tools include fetchedAt | | | |
| P-R4 | Consistent response envelope | | | |
| P-D1 | Tool descriptions verb-first | | | |
| P-D2 | Similar tools disambiguate each other | | | |
| P-D3 | Tool count < 25 | | | |
| P-D4 | Params have .describe() with examples | | | |
| P-N1 | No single-word param names | | | |
| P-N2 | Consistent naming convention (camelCase) | | | |
| P-E1 | Errors include resolution field | | | |
| P-E2 | Prerequisite errors name next tool | | | |
| P-S1 | External content wrapped as data | | | |
| P-S2 | GATE_EXEMPT at module scope + two-sided test | | | |
| P-C1 | System prompt rules in first 500 tokens | | | |
| P-C2 | Response size proportional to importance | | | |
| P-C3 | suggestedTools present where appropriate | | | |

### Step 3 — Report

For each FAIL or PARTIAL:
1. Quote the current code (file:line)
2. State which pattern it violates and why
3. Write the minimal fix (1-5 lines) — do not apply it

### Step 4 — Priority ranking

Rank all failures by impact:
- **Critical** (P-S2, P-E1, P-R1): directly causes agent failures or security gaps
- **High** (P-R2, P-R3, P-D1, P-D2): causes context drift or wrong tool selection
- **Medium** (P-N1, P-N2, P-D4, P-E2): increases hallucination rate
- **Low** (P-C2, P-C3, P-D3): degrades performance at scale

Output the gap table sorted by priority.

---

## Example Invocation

```
/audit-mcp apps/web/app/api/mcp/
```

If no path given, audit the whole MCP directory.

---

## How to Add This as a Claude Code Skill

Create `.claude/skills/audit-mcp.md` in your project with the content above.
Claude Code will make `/audit-mcp` available in any session in that project.

Or add it globally to `~/.claude/skills/audit-mcp.md` to use across all projects.
