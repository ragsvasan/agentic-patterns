# Gemini Deep Research — External Review Prompt

## Context

I'm an independent software engineer. Over the past month I built Stryde, a headless AI coaching system (TypeScript/Next.js + PostgreSQL + GCP Cloud Run). An LLM (Claude) acts as the coach by calling MCP (Model Context Protocol) tools — there is no in-app chat UI. The system came close to shipping with silent failures: seam-contract drifts, migration chain breaks, flaky QA that was measuring noise as signal, and agentic authority leaks. We stabilized it through several painful remediation cycles.

I've now distilled those incidents into three reusable assets (Tier 1 files, listed below):

1. **`STABILITY_GAP_TAXONOMY.md`** — 8 themes (~33 named gap classes) that cause silent production failures in agentic + data-persistence systems, each with: failure pattern, day-1 prevention, and a grep-able probe.
2. **`critical-gap-audit-skill.md`** — A Claude Code skill that runs the taxonomy probes against any project and produces a PASS/FAIL/PARTIAL/N-A table.
3. **`fast-start/` template** — 9-step day-1 runbook + scaffold files that install each gap class's prevention *before* feature code makes it expensive.

I'm asking for an adversarial external review before publishing these as reusable patterns.

---

## What I'm sending you

**Tier 1 — the deliverables under review (primary)**
- `STABILITY_GAP_TAXONOMY.md`
- `critical-gap-audit-skill.md`
- `fast-start/README.md`
- `fast-start/CLAUDE.md.template`
- `fast-start/ARCHITECTURE_INVARIANTS.md`
- `fast-start/QA_GATE_CHECKLIST.md`
- `fast-start/DAY1_RUNBOOK.md`
- `fast-start/scaffold/contract/canonical-ids.ts`
- `fast-start/scaffold/contract/boundary.ts`
- `fast-start/scaffold/contract/idempotency.ts`
- `fast-start/scaffold/tests/contract.example.test.ts`
- `fast-start/scaffold/tests/property.example.test.ts`
- `fast-start/scaffold/ci/ci.yml.template`
- `fast-start/scaffold/ci/latency-gate.example.ts`

**Tier 2 — source incidents that ground the taxonomy**
- `docs/LESSONS-LEARNED.md` — 25 Mnemo project engineering incidents (OAuth, Alembic, Redis, FastAPI, pgvector)
- `STABILITY_ARCHITECTURE.md` — Stryde-specific bug census (L1–L8 logic bugs; seam defect catalogue)
- `docs/retrospective-arc-draft.md` — narrative history of how we got here

**Tier 3 — supporting context (prevents false-positive "you're missing X" findings)**
- `UNIVERSAL_FIX_PATTERNS.md`
- `RESEARCH_PATTERNS.md`
- `HEADLESS_MCP_ENGINEERING_GUIDE.md`
- `LLM_AS_UI_PATTERNS.md`
- `QA_AGENT_DESIGN.md`
- `HEADLESS_COACH_QA_FRAMEWORK.md`

---

## Research questions

Please conduct adversarial research against the following six hypotheses. For each, confirm or refute using primary sources (named books, papers, industry standards, or well-known engineering postmortems). Cite the source for each finding.

### H1 — Theme coverage against industry canon

**Hypothesis:** The 8 themes (SEAM, FAIL, MIG, BOUNDARY, PERF, QA, AGENT, PROC) collectively cover the gap classes that industry literature (Nygard *Release It!*, Google SRE book ch.17–22, DORA State of DevOps reports, OWASP Top 10) flags as the dominant causes of production failures in persistence-backed, latency-sensitive services.

**Research ask:**
- What named failure patterns from Nygard (integration points, stability patterns, capacity antipatterns) are NOT represented in the taxonomy?
- What gap classes from Google SRE (ch.17 Testing Reliability, ch.21 Handling Overload, ch.22 Cascading Failures) are missing or misclassified?
- Are there gap classes from DORA's four key metrics framework (deploy freq, lead time, change-fail rate, MTTR) that the taxonomy's PROC-* theme omits?

### H2 — SEAM-2: consumer-driven contracts

**Hypothesis:** The taxonomy's SEAM-2 ("writer→reader contract matrix") is the practical equivalent of Consumer-Driven Contract Testing as defined by Martin Fowler and the Pact framework — and the scaffold's `contract.example.test.ts` is a workable lightweight implementation of that pattern.

**Research ask:**
- Is there a meaningful gap between what SEAM-2 describes and what formal CDC testing (Pact, Spring Cloud Contract) provides? Is the scaffold adequate for a small team, or does it miss something non-trivial?
- Does the industry literature recommend a different primary approach to writer→reader drift for the TS/Postgres + LLM-client stack described?

### H3 — QA measurement classification system

**Hypothesis:** The VPASS / VFAIL / QUAL / ART / NA classification system (QA-3 in the checklist) is aligned with how Google's SWE book and the "Testing in Production" literature distinguish deterministic assertions from probabilistic / judgment-dependent outcomes — and correctly identifies "ART" (harness artifact) as a distinct category that practitioners routinely collapse into FAIL, inflating apparent failure rates.

**Research ask:**
- Is the ART category (harness artifact — rate-limit, fixture drift, runner bug counted as product failure) recognized in testing literature? What term does the literature use?
- Does the literature support the claim that collapsing ART into FAIL is the primary cause of "noisy test suites that nobody trusts"?
- Is there a recognized classification system this resembles or that supersedes it?

### H4 — Agentic governance (TKA framework) vs. OWASP LLM Top 10

**Hypothesis:** The taxonomy's Theme G (AGENT-T/K/A/P/I — Totem, Kick, Architect, Point Man, Idempotency) collectively covers the agentic failure modes flagged by OWASP LLM Top 10 (2025 edition) and the emerging MCP security literature.

**Research ask:**
- Map each OWASP LLM Top 10 item to the nearest AGENT-* class. Which items have no coverage?
- Does the Totem concept (model output alone causes state write without independent check) correspond to a named pattern in agentic security literature?
- Is there an emerging standard (CoSAI, NIST AI RMF, MITRE ATLAS) that the taxonomy should reference for AGENT-* gap classes?

### H5 — Fast-start ordering and priority

**Hypothesis:** The DAY1_RUNBOOK.md step order (repo → migrations → test DB → CI → latency gate → observability → QA gate → contract scaffold → audit skill) reflects industry data on which structural decisions are cheapest to install on day 1 vs. most expensive to retrofit — specifically, that migration chain integrity (steps 2–3) and contract scaffolding (step 8) have the highest retrofit cost and should be mandatory before any feature code.

**Research ask:**
- Does industry literature (Accelerate, Google SRE, DORA reports) support "migrations before features" and "contract tests before feature tests" as the highest-ROI day-1 investments?
- Is the latency gate (step 5, asserting avg<500ms/p95<1000ms before any user traffic) consistent with SRE SLO literature on cold-start performance budgets?
- What step in the runbook, if any, does industry data say teams most commonly skip — and what is the typical cost?

### H6 — Missing gap classes (Themes I and J candidates)

**Hypothesis:** The 8-theme taxonomy is approximately complete for server-side agentic systems. There may be 1–2 missing themes worth adding, most likely in: (a) distributed coordination (dual-write, saga/compensation, transactional outbox — currently absent), and (b) supply-chain / dependency integrity (dependency pinning, SBOM, reproducible builds — currently only in PROC-2).

**Research ask:**
- Does the distributed-systems literature (Kleppmann *Designing Data-Intensive Applications*, ch. 7–9; Hohpe/Woolf *Enterprise Integration Patterns*) name a gap class for dual-write / transactional outbox that the current taxonomy omits and that would be relevant to a TS/Postgres system where the LLM writes to two tables in a single tool call?
- Does supply-chain / SBOM integrity (SLSA framework, SSDF) belong as a first-class gap theme for a system whose trust boundary includes LLM API providers and MCP tool servers? Or is PROC-2 sufficient?
- Are there other themes (network partition handling, secret rotation, blast-radius compartmentalization) that independent practitioners would flag as notably absent?

---

## What I'm NOT asking for

- Do NOT suggest general "best practices" that are already covered in the Tier 3 supporting docs (listed above). Those documents already address: MCP ergonomics, LLM-as-UI patterns, QA scenario harness design, agentic coaching QA. If you see something in Tier 3, note "already addressed in [doc name]" rather than treating it as a gap.
- Do NOT generate code. Research and citation only.
- Do NOT recommend tools or libraries unless they are the named industry-standard solution for a specific gap.

---

## Output format requested

For each hypothesis (H1–H6):

```
## H[N] — [title]
Verdict: CONFIRMED / REFUTED / PARTIALLY CONFIRMED
Summary: 2–3 sentences on the verdict.
Sources: [author, title, chapter/section or URL]
Gaps found (if any):
  - [gap name]: [what's missing] — [source authority]
Recommended addition to taxonomy (if any):
  - Theme [X], Class [Y]: [one-sentence description of the gap class]
```

Close with a **Priority shortlist**: the top 3 gaps (if any) ranked by "would cost the most to fix if discovered in production," with the specific taxonomy addition recommended for each.

---

*This is a technical review request. Please prioritize adversarial findings over confirmations — the goal is to find what the taxonomy gets wrong or misses, not to validate what it gets right.*
