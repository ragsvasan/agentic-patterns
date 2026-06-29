# Architecture Invariants — establish before writing features

> Copy into your repo. These are the structural decisions to make on **day 1**, before the
> first feature, because they are nearly impossible to retrofit once writes and reads are
> scattered across the codebase. Each invariant prevents a specific gap class from
> `STABILITY_GAP_TAXONOMY.md` (cited inline). An invariant that lives only in someone's head
> is not an invariant — encode it in the compiler, a test, or this document's matrix.

The meta-rule behind all of them (from the taxonomy): *a local check passed while a
downstream invariant was already broken.* Structure beats convention — make the invariant
something the compiler or a test enforces, not something a reviewer has to remember.

---

## INV-1 — Single normalization boundary (SEAM-1)

**Invariant:** every external value (integration field, tool arg, request body) is
canonicalized at **one** place — a transform at the dispatch edge — *before any business
code runs*. Business code and the DB only ever see canonical forms.

**Why:** SEAM-1 is data written under one type string and read under another (Stryde wrote
`hrv_rmssd`, read `HRV` — the safety gate silently never fired). If normalization is
scattered, the write side and read side drift and never intersect.

**How to encode it:**
- A Zod transform (or Pydantic validator) at the boundary — see
  `scaffold/contract/boundary.ts`.
- The canonical DB column is **branded** (`type CanonicalId = string & { __brand }`) so the
  compiler rejects a raw string written downstream — see `scaffold/contract/canonical-ids.ts`.
- **No read path re-normalizes.** If a read has to re-normalize, the write path is broken.

**Day-1 check:** grep the type/enum being written vs. the strings being queried. Both sides
must reference the *same canonical constant*, never string literals on each side.

---

## INV-2 — Writer→reader contract matrix is enumerated (SEAM-2)

**Invariant:** for every write entry point, you can name (a) the tables it writes, (b) the
read paths that consume that data, and (c) the contract test that proves the round-trip. A
new write entry point is **not done** until its row exists below and its round-trip test
passes.

**Why:** SEAM-2 is a data black hole — `log_subjective` wrote mood/soreness/RPE that *no
read tool surfaced* for weeks. The gap was invisible because no one had listed the paths.

**Fill this in (the matrix is the deliverable, keep it current):**

| Write entry point | Tables written | Read paths that consume | Round-trip test ID | Status |
|-------------------|----------------|-------------------------|--------------------|--------|
| `<createThing>`   | `<things>`     | `<getThing, listThings>`| `<contract:thing_roundtrip>` | ☐ |
| `<logEvent>`      | `<events>`     | `<getTimeline>`         | `<contract:event_surfaced>`  | ☐ |
| `<...>`           | `<...>`        | `<...>`                 | `<...>`            | ☐ |

> A row with no consuming read path is a black hole — either add the reader or delete the
> write. A row with no test ID is unverified. See `scaffold/tests/contract.example.test.ts`
> for the round-trip test shape and the seam-registry idea.

---

## INV-3 — Exhaustive enums / totality (SEAM-3, AGENT-A)

**Invariant:** the category space (enums, ID formats, tool set, permission scopes) is fixed
at build time. Every `switch`/`match` on a union has a `never`/exhaustive default. A new
variant added to the writer is added to *every* downstream branch in the same change.

**Why:** SEAM-3 — a new variant added in one place and not the others falls through a
default and is silently dropped (Stryde stored 5 of 7 screenshot metric types as raw
strings because the alias map had `VO2MAX` but the normalizer produced `VO2_MAX`). For
agentic systems this is also AGENT-A: a model must not be able to introduce a category the
persistence layer has never seen — reject it, don't absorb it.

**How to encode it:**
- Exhaustive `switch` with `default: { const _: never = val; throw new Error(...) }`.
- **Totality** property test: every alias maps to a non-null canonical.
- **Surjectivity** property test: every canonical is reachable from ≥1 alias (a dead
  canonical fails the test). See `scaffold/tests/property.example.test.ts`.

---

## INV-4 — One entry point per operation (SEAM-4)

**Invariant:** each logical operation (dedup, log, normalize, create-X) has **one**
implementation. If a second one is unavoidable (server pkg vs. client pkg), they share a
code path or are explicitly cross-referenced here so a fix lands on both.

**Why:** SEAM-4 — the same operation with two implementations means a fix lands on the path
users *don't* hit (Mnemo: 404 fixed in the deployed backend; the real bug was in the client
pip package calling a stale route — a full deploy for nothing).

**Day-1 check / register duplicates here:**

| Operation | Implementations | Shared path? |
|-----------|-----------------|--------------|
| `<dedup>` | `<server/dedup.ts>` (only) | n/a |
| `<...>`   | `<...>`         | `<...>` |

> When debugging a contract/protocol layer, grep the **caller** first and confirm the exact
> path it takes before touching any implementation.

---

## INV-5 — Config that varies per-entity lives in the DB (BOUNDARY-5)

**Invariant:** allowlists and per-entity configuration (e.g. OAuth `redirect_uri` origins,
per-tenant limits) are **DB rows validated dynamically**, not env-var lists that require a
deploy to extend. Env vars are for secrets and deploy-time constants only.

**Why:** BOUNDARY-5 — an env-var allowlist breaks the moment a second client appears and
every addition is a redeploy (Mnemo: should have been DB-stored dynamic client registration
per RFC 8252).

**Day-1 check:** grep env-var allowlists used in request validation. If the list is expected
to grow per-entity, it's a table.

---

## INV-6 — Agentic governance (AGENT-T / K / A / P / I)

> Applies only if an LLM/agent can write state, loop autonomously, hold memory, or spawn
> sub-agents. Skip for non-agentic projects. The four authority leaks are T-K-A-P; the
> fifth is idempotency.

- **AGENT-T (Totem) — deterministic commit layer the model can't reason around.** Two-stage
  commit for write tools: no `confirmed=true` ⇒ preview only; the model proposes, a
  deterministic layer commits. Gate-exempt sets defined at **module scope**, never inside
  the handler. A proof-of-validity token (e.g. "this plan came from the real planner") must
  be issued by the deterministic layer, never fabricated by the model.
- **AGENT-K (Kick) — stop conditions are deterministic and session-sticky.** A turn/loop cap
  enforced outside the model. Once a convergent-stop or safety-stop fires it survives across
  turns; the model cannot reset it by rewording.
- **AGENT-A (Architect) — fixed category space at runtime.** Covered by INV-3: runtime
  category/tool/permission additions are rejected, not absorbed.
- **AGENT-P (Point Man) — explicit authority provenance across delegation.** A sub-agent's
  writes carry *its own* scoped authority + delegation path + depth, never an inherited
  blanket credential.
- **AGENT-I — idempotency key on every write.** See `scaffold/contract/idempotency.ts`.

---

## INV-7 — No SSRF via a model-influenced URL (BOUNDARY-7)

> Applies if any tool fetches a resource from a URL — or builds one from an identifier — that
> the LLM supplied or that came from attacker-controllable content. Skip if no tool fetches a
> model-influenced destination.

**Invariant:** any tool that fetches a model-influenced URL validates the **resolved**
destination against an allowlist (scheme + host) and blocks private/link-local ranges *after*
DNS resolution. Prefer opaque IDs resolved server-side over free-form URLs.

**Why:** BOUNDARY-7 — because the model can be steered by injected content (AGENT-S), an
attacker drives it to fetch an internal target, most dangerously the cloud metadata endpoint
`http://169.254.169.254/…`, exfiltrating the instance's service-account token and escalating to
full cloud compromise (OWASP LLM05 / SSRF).

**How to encode it:**
- Validate the resolved destination *after* DNS resolution (defeats DNS rebinding), not the raw
  string. Block `169.254.0.0/16`, `10/8`, `127/8`, `::1`, and the other private/link-local ranges.
- Allowlist scheme + host; reject everything else with a typed error.
- Where possible, accept an **opaque ID** the server resolves to a URL it controls — never a
  free-form URL from the model.

**Day-1 check:** grep tools that take a URL/host/identifier and fetch it. Is the destination
allowlisted and are private/link-local IPs blocked *post-resolution*?

---

## INV-8 — Resilience under load (RESIL-1/2/3/4)

> Applies if the service is horizontally autoscaled, fronts a shared datastore, calls an
> external dependency on a request path, or is driven by an LLM client that can retry. Skip for
> a single-instance, no-external-dependency service.

**Invariant:** every cross-process call is **bounded and isolated** — wrapped in a circuit
breaker (RESIL-1), drawn from a per-dependency bulkhead pool (RESIL-2), behind a client-side
adaptive throttle + backoff-with-jitter (RESIL-3), and given a per-call timeout that rolls up
into an enforced end-to-end request budget (RESIL-4).

**Why:** a public, autoscaled deployment with an LLM retrying on timeout violates the
trusted-low-throughput assumption the seam/boundary invariants were written under. A transient
slow query becomes a self-inflicted denial of service: retries multiply, the autoscaler adds
instances, each opens its own pool, and Postgres `max_connections` is exhausted — global
blackout. (Nygard *Release It!* ch. 4–5; Google SRE ch. 21–22.)

**How to encode it:**
- One breaker **per dependency** (never one global) — see `scaffold/resilience/circuit-breaker.example.ts`.
- A bounded concurrency pool per external dependency class (the bulkhead).
- Adaptive throttle (`max(0, (requests − K·accepts)/(requests + 1))`, `K=2`) + backoff with
  jitter — see `scaffold/resilience/adaptive-throttle.example.ts`.
- Size pools so `max_instances × pool_size < Postgres max_connections`.

**Day-1 check:** grep cross-process calls (`fetch`, `httpx`, `pool.acquire`, MCP client calls).
Is each wrapped in a breaker + timeout? Compute `max_instances × pool_size` — under the DB
ceiling?

---

## INV-9 — No raw dual write; outbox + idempotent consumer (DIST-1/2/3)

> Applies if any single logical action writes to more than one store, service, or external
> system. Skip for strictly single-database systems.

**Invariant:** a logical action that spans two stores never does a raw dual write (DB then a
second-service call). It writes the business row **and** an event row in **one** ACID
transaction (the **transactional outbox**, DIST-1); a separate publisher forwards the event
at-least-once; the **consumer is idempotent** on the event id (DIST-3). Multi-service operations
that genuinely can't share a transaction use an orchestrated **saga** with compensating
transactions (DIST-2) — but first collapse to one transaction if you can.

**Why:** DIST-1 — a crash between the local commit and the second-service call leaves the two
stores permanently divergent with nothing to roll back. AGENT-T's two-stage commit and AGENT-I's
idempotency key both operate inside *one* database; neither can undo a commit that already landed
in a different one. (Kleppmann *DDIA* ch. 9; Hohpe & Woolf *EIP*.)

**How to encode it:**
- `scaffold/distributed/transactional-outbox.sql` (outbox table + partial unprocessed index) +
  `scaffold/distributed/outbox-publisher.example.ts` (atomic write, at-least-once poller,
  idempotent consumer).
- Dedupe every consumer on the event id (unique constraint or idempotent `UPSERT`) — assume each
  event arrives twice.

**Day-1 check:** grep for a DB write followed by an external/second-service call in the same
handler with no outbox between them. For each event/queue/webhook consumer, is there a dedupe on
event id?

---

## The day-1 sequence

1. Decide the canonical id/enum space and write `scaffold/contract/canonical-ids.ts` (INV-1,
   INV-3).
2. Stand up the normalization boundary `scaffold/contract/boundary.ts` (INV-1).
3. Write the totality/surjectivity property tests — they should pass before feature #1
   (INV-3).
4. Create the INV-2 matrix above with at least your first write entry point and its
   round-trip test.
5. If agentic: wire idempotency + two-stage commit + module-scope gate sets (INV-6).
6. If any tool fetches a model-influenced URL: allowlist + post-resolution private-IP block
   (INV-7).
7. If autoscaled / calls an external dependency on a request path: breaker + bulkhead + throttle
   + timeout budget (INV-8).
8. If any action writes to two stores: the transactional outbox + idempotent consumer (INV-9).
