# Gemini External Review — Reconciliation

> Records how the adversarial external review (Gemini Deep Research, run 2026-06-29 against
> the Tier 1+2 files) was reconciled against the self-assessment baseline in
> `STABILITY_GAPS_SELF_FOUND.md`. Each finding is classified: **NOVEL** (real gap we
> missed → added), **REFINED** (we had it but the review sharpened it → edited in place),
> **ALREADY COVERED** (in the taxonomy or Tier-3 docs → noted, no change), or **DECLINED**
> (out of scope / not confirmed → left as-is, with reason).
>
> **Date:** 2026-06-29 · **Reviewer:** Gemini Deep Research · **Baseline:** `STABILITY_GAPS_SELF_FOUND.md`

---

## Verdict by hypothesis

| Hyp | Topic | Gemini verdict | Our action |
|-----|-------|----------------|------------|
| H1 | Theme coverage vs. Nygard / Google SRE / DORA | **Partially confirmed** — resilience theme missing | Added **Theme I** (RESIL-1..4) |
| H2 | SEAM-2 ≈ Consumer-Driven Contracts | **Partially confirmed** — manual matrix lacks enforcement across services | **Refined SEAM-2**: escalate to Pact/CDC when producer≠consumer service |
| H3 | VPASS/VFAIL/QUAL/ART/NA classification | **Confirmed** — ART is real and routinely collapsed into FAIL | No change (validated); added crash-/parallel-safe isolation to QA-3 |
| H4 | Theme G (TKA) vs. OWASP LLM Top 10 | **Partially confirmed** — several LLM items uncovered | Added **AGENT-S**, **AGENT-W**, **BOUNDARY-7**; extended **AGENT-P** (confused deputy / shadowing) |
| H5 | Fast-start ordering | **Confirmed** — migrations-before-features and contract-before-feature are highest-ROI | No reorder; added MIG-5 + rolling-deploy note to runbook |
| H6 | Missing themes (distributed, supply-chain) | **Confirmed for distributed; not confirmed for SBOM** | Added **Theme J** (DIST-1..3); SBOM left as PROC-2 advisory |

---

## NOVEL — genuine gaps we missed (added to taxonomy)

These map directly to the "Gaps we have NOT yet verified" table in the baseline. Gemini
confirmed each against named canon, moving them from *unverified* to *confirmed*.

| Baseline row | Confirmed as | Source authority | Now lives at |
|--------------|--------------|------------------|--------------|
| Circuit breaker / bulkhead (Nygard ch.4–5) | RESIL-1, RESIL-2 | Nygard *Release It!* ch. 4–5 | Theme I |
| (implicit in PERF) retry storm / pool exhaustion | RESIL-3 | Google SRE ch. 21 *Handling Overload* (client-side adaptive throttling, `K=2`) | Theme I |
| (implicit) no hot-path timeout budget | RESIL-4 | Google SRE ch. 22 *Cascading Failures* | Theme I |
| Distributed dual-write / transactional outbox | DIST-1 | Kleppmann *DDIA* ch. 9; Hohpe & Woolf *EIP* (transactional outbox) | Theme J |
| Saga / compensation for multi-table writes | DIST-2 | *EIP* / saga pattern (Garcia-Molina) | Theme J |
| (new) at-least-once consumer dedup | DIST-3 | *EIP* idempotent receiver | Theme J |
| (new) SSRF via agent-synthesized URL | BOUNDARY-7 | OWASP LLM05 / SSRF; GCP metadata `169.254.169.254` | Theme D |
| (new) semantic / indirect prompt injection beyond shape validation | AGENT-S | OWASP LLM01 + LLM04 (RAG poisoning) | Theme G |
| (new) denial-of-wallet / unbounded agentic cost | AGENT-W | OWASP LLM10 (unbounded consumption) | Theme G |

**Net new:** 2 themes (I, J), 10 gap classes (RESIL-1..4, DIST-1..3, BOUNDARY-7, AGENT-S, AGENT-W), 1 migration class (MIG-5).

---

## REFINED — we had it, the review sharpened it (edited in place)

- **MIG-2 → added MIG-5.** Gemini's strongest correctness finding: "migration in the same
  commit as the code" (MIG-2) is *necessary but not sufficient* under a rolling deploy,
  where old and new containers serve concurrently. A destructive migration (NOT NULL
  without default, rename, drop, type-narrow) crashes the still-running old container the
  instant it applies. Added **MIG-5** (Parallel Change / expand-contract) and cross-linked
  from MIG-2. *Source: Sato/Fowler "Parallel Change"; standard zero-downtime migration practice.*
- **SEAM-2 → Pact escalation.** The manual contract matrix has no automated enforcement and
  silently rots once producer and consumer are *different services*. Added the named
  escalation to Consumer-Driven Contract testing (Pact / Spring Cloud Contract) with
  `can-i-deploy` as the deploy gate. *Source: Fowler "Consumer-Driven Contracts"; Pact docs.*
- **BOUNDARY-5 → Twelve-Factor reconciliation.** Gemini flagged an apparent conflict between
  "config in the DB" and Twelve-Factor "config in env". The baseline prevention was already
  correct in spirit; clarified the split explicitly — *deploy-time secrets/handles in env;
  runtime business config that scales with onboarding in the DB* — and added the
  chicken-and-egg bootstrap counter-probe. *Source: Twelve-Factor App §III.*
- **AGENT-P → confused deputy / tool shadowing.** Extended Point Man to name the
  multi-MCP-server forms: blind service-credential pass-through (confused deputy) and
  duplicate-tool-name capture (shadowing), with audience/scope validation on pass-through
  tokens. *Source: NSA/OWASP MCP guidance; OAuth confused-deputy.*
- **QA-3 → crash-safe + parallel-safe isolation.** Gemini found two concrete scaffold
  hazards: a scenario that dies mid-run leaves a blocking condition set (poisoning later
  runs), and a hardcoded `test-user-001` makes concurrent CI runs truncate each other.
  Added `try/finally` teardown and fresh-UUID-per-run to QA-3's prevention and probe.

---

## NOVEL (QA) — added as first-class classes

- **QA-6 — mutation testing.** Tautological assertions (tests asserting current output, not
  correct behavior) give high line coverage with near-zero fault detection — endemic to
  after-the-fact and LLM-generated tests. Added with Stryker/`mutmut` and a mutation-score
  floor. *Source: Gemini citing mutation-testing literature; Stryker docs.*
- **QA-7 — metamorphic testing + boundary fuzzing.** The LLM-output oracle problem: no fixed
  expected string, so assertions are brittle or absent. Metamorphic relations (more
  duration ⇒ strictly more calories) are hard invariants that don't need an exact oracle.
  *Source: Chen et al. metamorphic testing; fast-check/Hypothesis property fuzzing.*

---

## ALREADY COVERED — noted, no change

- **Idempotency on write tools (AGENT-I).** Gemini correctly notes AGENT-I makes retries
  *safe* but doesn't *bound their rate* — that boundedness gap is exactly what RESIL-3 now
  adds. AGENT-I itself stands.
- **Excessive agency / two-stage commit.** Gemini's "session-bound RBAC per tool" is the
  enforcement side of AGENT-T (deterministic gate) + BOUNDARY-2/4 (auth-first, tenant
  scoping). Already covered; AGENT-S adds the injection vector that motivates it.
- **Prompt-injection scrubber on all write paths.** Already BOUNDARY-6; AGENT-S generalizes
  it to the read/retrieval channel and the "data not instructions" framing.
- **System-prompt / tool-schema leakage (OWASP LLM07).** Acknowledged but *declined as a
  taxonomy class* — it is an information-disclosure concern without a silent-data-corruption
  failure mode, which is this taxonomy's scope. Noted here for completeness; belongs in the
  `llm_application_security.md` persona, not the stability taxonomy.

---

## DECLINED — left as-is, with reason

- **SBOM / supply-chain as a first-class theme (H6b).** Gemini did **not** substantively
  research or confirm this (no SLSA/SSDF citation returned). The baseline already carries it
  as PROC-2 advisory. **No change** — revisit only if a dedicated supply-chain review
  confirms it. This remains the one open "not yet verified" item from the baseline.
- **Canary / progressive delivery gating; secret rotation during live traffic.** Not
  addressed by this review. Left as baseline "not addressed" rows; candidates for a future
  PROC-* or a deployment-focused review, not added speculatively.
- **Adaptive-throttle / outbox/ saga reference code.** Gemini supplied implementation code
  despite the "no code" instruction. We did **not** paste it verbatim; the fast-start
  scaffold re-implements the patterns cleanly in the repo's existing style.

---

## Baseline table — updated status

The "Gaps we have NOT yet verified" table in `STABILITY_GAPS_SELF_FOUND.md` is now resolved
as follows:

| Gap | Prior status | Post-review status |
|-----|--------------|--------------------|
| Distributed dual-write / transactional outbox | Not addressed | **Confirmed → DIST-1** |
| Saga / compensation for multi-table writes | Not addressed | **Confirmed → DIST-2** |
| Circuit breaker / bulkhead | Not addressed | **Confirmed → RESIL-1/2** |
| Supply-chain / SBOM integrity | Partial (PROC-2) | **Not confirmed by review — stays PROC-2 advisory** |
| Canary / progressive delivery gating | Not addressed | Not addressed (out of review scope) |
| Secret rotation during live traffic | Not addressed | Not addressed (out of review scope) |
