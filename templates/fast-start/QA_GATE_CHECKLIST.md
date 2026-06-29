# QA Gate Checklist — the commit gate

> Copy into your repo. This is the gate every change passes *before* it commits. Each
> section maps to a gap class in `STABILITY_GAP_TAXONOMY.md` Theme F (cited inline). The
> reliability you ship is a property of this gate, not of the model or of good intentions.

The commit cycle:

```
code → tests → panel → fix → tests → panel → (repeat until clean) → commit
```

---

## QA-1 — Panel before commit (tiered by risk)

A review that runs *after* commit is documentation, not quality control. The panel **gates**
the commit; FAILs are blockers, not follow-up tasks. Tier it so it's cheap on low-risk diffs.

**Before spawning any panel, declare the tier in one line:** `Panel tier: T[N] — <reason>`.
If you can't write the reason in one sentence, the classification is ambiguous — resolve it
first.

| Tier | When | Passes |
|------|------|--------|
| **T1 — Full** | New auth/permission logic; major rewrite (>50% of a module); new service/route/data boundary; new agent write tool or schema change | Defense + security review + adversary (all parallel) |
| **T2 — Security** | Non-auth feature touching DB writes; new external integration; rate-limiting; new/modified agent write-tool handler | Defense + security review (parallel) |
| **T3 — Lean** | Non-security logic: heuristics, string/config changes, non-DB utility functions | Defense only |
| **T4 — Skip** | Typo, log wording, comment, test-only change with zero auth/DB involvement | None |

**Defense pass covers:** execution path (is the new fn actually in the call chain?), wiring
gaps, locked contracts (does this violate an `ARCHITECTURE_INVARIANTS.md` entry?), sibling
instances (SEAM-4 — did you fix every copy?), tests.

**When in doubt, go up one tier.** A 10-minute panel is cheaper than a prod incident.

---

## QA-2 — Tests are part of the deliverable

Written in the **same change** as the code — never "later."

- [ ] Every new **gate/enforcement** has one test entering at the **public entry point**
      that asserts the gate fired (not a unit test on the function in isolation).
- [ ] Every new **enum/ID format** has one load→process→output test, not just a parser test.
- [ ] Every **bug fix** has a `regression` test that fails before the fix and passes after,
      entering at the public entry point (FAIL-5 — write it *before* the fix).
- [ ] **No mock-only coverage of a write path** (FAIL-3). Integration tests hit real DB/APIs
      where possible. Mocks are signature-enforced (`create_autospec` / typed doubles), never
      bare mocks that accept any call signature.

---

## QA-3 — Measurement honesty (noise is not signal)

A pass count is worthless if runs aren't comparable. Classify **every** result; only VPASS
and VFAIL count toward progress.

| Class | Meaning |
|-------|---------|
| **VPASS** | A deterministic assertion held. Real progress. |
| **VFAIL** | A real bug reproduced. Real progress (fix it). |
| **QUAL**  | Quality outcome that needs a judge (LLM/human), not a deterministic assert. |
| **ART**   | Harness artifact (rate-limit, fixture drift, runner bug). Not a product result. |
| **NA**    | Not runnable in this environment (missing connector/key). |

Also required for honest measurement:

- [ ] **Per-scenario isolation.** Reset mutable state between scenarios. One scenario's
      state must not bleed into the next (Stryde: a return-to-training scenario poisoned ~10
      downstream results).
- [ ] **Stable denominator.** The number of scenarios counted is fixed run-to-run; don't
      shift the denominator to flatter a headline.
- [ ] **Test-mode time windows match prod.** A test-mode TTL/staleness window that differs
      from prod tests a fiction. Assert they match.
- [ ] **"Didn't throw" ≠ "passed."** A scenario that merely avoided an error is QUAL at best,
      never VPASS.

---

## QA-4 — Classify bugs L1 vs L2 (don't blame the model for a seam defect)

When output looks wrong, find the root cause class **before** reaching for the prompt:

- **L2 — deterministic seam defect.** Enum mismatch, singular/plural, alias drift, unit
  mismatch. **It reproduces with no LLM in the loop** — call the tools directly and the bug
  is still there. The model faithfully reported corrupt data. *Fix the contract; every L2
  finding references a seam-contract ID or adds one.* L2s are cheaper to fix and more
  important to catch — they're invisible to the model.
- **L1 — judgment error.** The model made a bad call on correct data. *Fix the prompt / tool
  description.*

- [ ] **The test:** can you reproduce the wrong output by calling the tools directly with no
      model? If yes → L2 → is there a seam contract covering it? If no → L1.

> Misdiagnosing an L2 as "the LLM hallucinated" ships the bug — the prompt change does
> nothing because the data was already corrupt.

---

## QA-5 — Dated audit ledger / regression baseline

- [ ] Audit runs are recorded in a dated ledger: `docs/audits/INDEX.md` + one file per run
      with **run date → build SHA → VPASS/VFAIL counts → notes**.
- [ ] The latest clean sweep is the **regression baseline**. A new run is compared against
      it; a drop is a regression to investigate, not a new normal.
- [ ] Results in the ledger use the QA-3 classification, so runs are comparable.

> Without a dated ledger, every audit is a one-off and regressions are undetectable.

---

## One-line pre-commit self-check

```
[ ] Panel tier declared + run, FAILs fixed        (QA-1)
[ ] Tests in this change; gate/format entry-point test present (QA-2)
[ ] Results classified VPASS/VFAIL/QUAL/ART/NA; isolation on; test TTL == prod (QA-3)
[ ] Wrong output triaged L1 vs L2; L2s have a seam-contract ID (QA-4)
[ ] Ledger updated with date + SHA + counts        (QA-5)
```
