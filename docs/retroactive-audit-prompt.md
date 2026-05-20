# Retroactive Audit — New Session Prompt

Use this to audit an existing project against all 17 patterns.
Give this to a new session pointed at the project directory.

---

## Prompt

> **Task:** Audit the MCP tool implementation in this project against 17 research-backed
> engineering patterns. Read code only — do not write or fix anything.
>
> **Read first:**
> `~/agentic-patterns/docs/RESEARCH_PATTERNS.md` — the full pattern catalogue with rationale.
>
> **Then audit these locations:**
>
> ```bash
> # Find manifest (tool descriptions + schemas)
> grep -r "inputJsonSchema\|description:" --include="*.ts" -l
>
> # Find route handler (GATE_EXEMPT location)
> grep -r "GATE_EXEMPT\|SAFETY_SHELL_EXEMPT\|POST(" --include="*.ts" -l
>
> # Find tool response construction
> grep -r "return {" apps/web/app/api/mcp/ --include="*.ts" | head -40
>
> # Find error construction
> grep -r "error:\|resolution:" apps/web/app/api/mcp/ --include="*.ts" | head -40
>
> # Find system prompt
> grep -r "system\|systemPrompt\|SYSTEM_PROMPT" --include="*.ts" -l
>
> # Check suggestedTools usage
> grep -r "suggestedTools\|fetchedAt" --include="*.ts" -l
> ```
>
> **Produce this exact output:**
>
> ### Gap Table
>
> | Pattern | Status | File:Line | Severity | Fix (1 sentence) |
> |---|---|---|---|---|
> | P-R1: Primary value at top level | PASS/FAIL/PARTIAL | | Critical/High/Med/Low | |
> | P-R2: Write tools return full record | | | | |
> | P-R3: fetchedAt in read responses | | | | |
> | P-R4: Consistent response envelope | | | | |
> | P-D1: Verb-first descriptions | | | | |
> | P-D2: Similar tools disambiguated | | | | |
> | P-D3: Tool count < 25 | | | | |
> | P-D4: Params have .describe() + example | | | | |
> | P-N1: No single-word param names | | | | |
> | P-N2: Consistent naming (camelCase) | | | | |
> | P-E1: Errors have resolution field | | | | |
> | P-E2: Prerequisite errors name next tool | | | | |
> | P-S1: External content wrapped as data | | | | |
> | P-S2: GATE_EXEMPT module-scope + tested | | | | |
> | P-C1: System prompt rules first 500 tokens | | | | |
> | P-C2: Response size proportional | | | | |
> | P-C3: suggestedTools as required queue | | | | |
>
> ### Critical Failures (fix first)
> For each FAIL rated Critical or High:
> - Quote the current code (file:line)
> - Explain why it violates the pattern
> - Write the minimal fix
>
> ### What Is Already Good
> List the PASSes briefly — 1 line each.
>
> **Be critical. A pattern that is partially implemented is a PARTIAL, not a PASS.**

---

## How to Use the Output

1. Sort the gap table by severity
2. Create a ticket per Critical/High failure
3. Assign Medium/Low to a cleanup sprint
4. Re-run the audit after fixes — a new session, same prompt

This audit should take ~20 minutes per project. Run it:
- On any new project before shipping MCP tools
- After any significant refactor of the MCP layer
- Quarterly as a health check
