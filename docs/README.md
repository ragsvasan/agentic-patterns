# Research Patterns — MCP Agent Engineering

Patterns extracted from primary research on LLM tool use, synthesized into
actionable engineering rules. Four files — read in this order.

---

## Files

### 1. `RESEARCH_PATTERNS.md`
17 patterns derived from 8 research sources. Each pattern has:
- The finding it comes from (cited)
- A bad/good code example
- A one-line rule

**Goes into:** `~/agentic-patterns/docs/`

---

### 2. `claude-md-addition.md`
The CLAUDE.md section to paste into every project.
A checklist Claude Code applies automatically on every MCP-related review.

**Goes into:** Each project's `CLAUDE.md`

---

### 3. `audit-mcp-skill.md`
The `/audit-mcp` skill definition.
Run it in any session to get a gap table against all 17 patterns.

**Goes into:** `~/.claude/skills/audit-mcp.md` (global) or `.claude/skills/audit-mcp.md` (per project)

---

### 4. `retroactive-audit-prompt.md`
The prompt to give a new session for auditing existing code.
Use this for projects that already have MCP tools built.

**Goes into:** Keep as a reference — paste into new sessions as needed.

---

## Skill vs CLAUDE.md — which is better?

Both. They serve different purposes:

| | CLAUDE.md | `/audit-mcp` Skill |
|---|---|---|
| When it runs | Every session, automatically | On demand |
| What it does | Applies rules during new work | Audits existing code |
| Good for | New tools, reviews, PRs | Retroactive checks, health audits |
| Cost | Always-on, lightweight | One session per audit |

**CLAUDE.md** is the always-on behavioral layer — it prevents new violations.
**The skill** is the retroactive layer — it finds existing violations.

You need both. CLAUDE.md alone misses existing code. The skill alone is forgotten.

---

## How to ensure all projects follow these patterns

1. Add `RESEARCH_PATTERNS.md` to `~/agentic-patterns/docs/`
2. Add the `audit-mcp-skill.md` to `~/.claude/skills/` globally (affects all projects)
3. Paste `claude-md-addition.md` into each project's `CLAUDE.md` with updated paths
4. Run the retroactive audit on each existing project once to establish a baseline
5. Re-run the audit quarterly or after major MCP changes

---

## Sources (for reference)

- ReAct: [arxiv.org/abs/2210.03629](https://arxiv.org/abs/2210.03629)
- Lost in the Middle: [arxiv.org/abs/2307.03172](https://arxiv.org/abs/2307.03172)
- Butterfly Effects in Toolchains: [arxiv.org/abs/2507.15296](https://arxiv.org/abs/2507.15296)
- Tool Selection Hallucinations: [arxiv.org/abs/2601.05214](https://arxiv.org/abs/2601.05214)
- WildToolBench: [arxiv.org/abs/2604.06185](https://arxiv.org/abs/2604.06185)
- AI Engineering (Chip Huyen): [huyenchip.com](https://huyenchip.com)
- Anthropic Context Engineering: [anthropic.com/engineering](https://anthropic.com/engineering)
- Simon Willison Prompt Injection Patterns: [simonwillison.net](https://simonwillison.net)
