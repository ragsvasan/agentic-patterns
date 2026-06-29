/**
 * circuit-breaker.example.ts — minimal circuit breaker wrapping a cross-process call.
 *
 * PREVENTS:
 *   RESIL-1 (integration point with no circuit breaker): a downstream (DB, external API, a
 *           second MCP server) that hangs or slows makes every caller block on it; threads /
 *           event-loop slots fill and the slowness propagates UP, taking down tools that don't
 *           even use that dependency (Nygard: the integration point is the #1 cascading-failure
 *           source). A breaker fails FAST while the peer is sick — a typed error beats a hung
 *           request.
 *   RESIL-2 (no bulkhead): see the §"bulkhead" note at the bottom — one breaker per dependency,
 *           plus a bounded concurrency pool per failure domain, so a slow peer can only exhaust
 *           its OWN partition, never the shared core path.
 *
 * The state machine:
 *   CLOSED    → calls pass through. N consecutive failures (or a slow call) ⇒ OPEN.
 *   OPEN      → calls fail fast with a typed error, no downstream call. After cooldown ⇒ HALF_OPEN.
 *   HALF_OPEN → one probe call allowed; success ⇒ CLOSED (recovered), failure ⇒ OPEN again.
 *
 * Copy-then-edit: one breaker instance PER downstream dependency (never one global breaker —
 * that couples unrelated peers). Pair each with its own bulkhead pool (RESIL-2) and a per-call
 * timeout (RESIL-4 — a breaker counts a hung call as a failure only if the call can time out).
 */

export class CircuitOpenError extends Error {
	constructor(public readonly dependency: string) {
		// Structured, caller-returnable — fail fast and loud, never silently stale (FAIL-2).
		super(`CIRCUIT_OPEN: "${dependency}" is unhealthy; failing fast. Retry after cooldown.`)
		this.name = 'CircuitOpenError'
	}
}

type State = 'CLOSED' | 'OPEN' | 'HALF_OPEN'

export interface BreakerOptions {
	dependency: string // name of the downstream — one breaker per dependency
	failureThreshold?: number // consecutive failures before opening (default 5)
	cooldownMs?: number // how long to stay OPEN before a half-open probe (default 10_000)
	callTimeoutMs?: number // per-call deadline; a timeout counts as a failure (RESIL-4, default 2_000)
}

export class CircuitBreaker {
	private state: State = 'CLOSED'
	private consecutiveFailures = 0
	private openedAt = 0
	private readonly dep: string
	private readonly threshold: number
	private readonly cooldownMs: number
	private readonly callTimeoutMs: number

	constructor(opts: BreakerOptions) {
		this.dep = opts.dependency
		this.threshold = opts.failureThreshold ?? 5
		this.cooldownMs = opts.cooldownMs ?? 10_000
		this.callTimeoutMs = opts.callTimeoutMs ?? 2_000
	}

	/** Wrap a cross-process call. Fails fast while OPEN; probes once while HALF_OPEN. */
	async call<T>(fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
		if (this.state === 'OPEN') {
			if (Date.now() - this.openedAt < this.cooldownMs) throw new CircuitOpenError(this.dep)
			this.state = 'HALF_OPEN' // cooldown elapsed → allow one probe
		}

		// RESIL-4: every cross-process call gets a deadline. A hung peer must surface as a
		// failure, not a permanent stall — otherwise the breaker never trips.
		const controller = new AbortController()
		const timer = setTimeout(() => controller.abort(), this.callTimeoutMs)
		try {
			const result = await fn(controller.signal)
			this.onSuccess()
			return result
		} catch (err) {
			this.onFailure()
			throw err // re-throw — never swallow (FAIL-1)
		} finally {
			clearTimeout(timer)
		}
	}

	private onSuccess(): void {
		this.consecutiveFailures = 0
		this.state = 'CLOSED' // a HALF_OPEN probe that succeeded means the peer recovered
	}

	private onFailure(): void {
		this.consecutiveFailures += 1
		// A failed HALF_OPEN probe re-opens immediately; in CLOSED, open at the threshold.
		if (this.state === 'HALF_OPEN' || this.consecutiveFailures >= this.threshold) {
			this.state = 'OPEN'
			this.openedAt = Date.now()
		}
	}

	/** For metrics/observability (PROC-3): emit this so an open breaker pages, not hides. */
	get currentState(): State {
		return this.state
	}
}

/* ── Bulkhead note (RESIL-2) ──────────────────────────────────────────────────────────────
 *
 * A breaker stops a sick peer from being CALLED; a bulkhead stops a slow-but-not-yet-tripped
 * peer from CONSUMING every connection. Partition resources by failure domain:
 *
 *   // one bounded concurrency permit pool PER external dependency class:
 *   const telemetryPool = new Semaphore(8)   // wearable API — max 8 concurrent
 *   const coachingPool  = new Semaphore(16)  // core path — its own partition
 *
 *   await telemetryPool.run(() => telemetryBreaker.call((sig) => fetchTelemetry(sig)))
 *
 * Now a stalled telemetry peer can saturate at most its 8 permits — the coaching path keeps
 * its 16 and stays healthy. One global pool would let the slow peer starve everything.
 *
 * Postgres corollary (RESIL-3): size each pool so `max_instances × pool_size` stays UNDER
 * the server's `max_connections`, or saturated autoscaling blacks out the DB.
 */
