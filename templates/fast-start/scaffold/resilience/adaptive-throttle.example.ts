/**
 * adaptive-throttle.example.ts — client-side adaptive throttle + backoff with jitter.
 *
 * PREVENTS:
 *   RESIL-3 (unbounded retry → request storm → pool exhaustion): a client (LLM or otherwise)
 *           that retries on timeout with no backoff and no client-side throttle multiplies load
 *           exactly when the server is already struggling — latency spikes → retries multiply →
 *           the autoscaler spins up more instances → each opens its own pool → Postgres
 *           `max_connections` ceiling is hit → global blackout. AGENT-I makes retries SAFE; it
 *           does NOT bound their RATE. This does.
 *   RESIL-4 (no timeout budget): see the §"timeout budget" note — backoff is only meaningful if
 *           each attempt has a deadline so a hung call can't sit forever between retries.
 *
 * Two mechanisms, both from Google SRE (Handling Overload, ch. 21):
 *   1. Adaptive throttle — the client drops requests LOCALLY (before they hit the wire) with
 *      probability  p = max(0, (requests − K·accepts) / (requests + 1)),  default K = 2.
 *      When the server rejects a lot, `accepts` lags `requests`, p climbs, and the client
 *      sheds its own load — no request storm against a sick backend.
 *   2. Exponential backoff WITH JITTER between retries — so N clients that all failed at the
 *      same instant don't retry in a synchronized thundering herd.
 *
 * Copy-then-edit: wrap your real cross-process call. Pair with the circuit breaker
 * (circuit-breaker.example.ts) — the breaker fails fast while OPEN; the throttle bounds the
 * rate of the calls that do go through.
 */

export class ThrottledError extends Error {
	constructor() {
		super('CLIENT_THROTTLED: request dropped locally to protect the backend. Back off and retry.')
		this.name = 'ThrottledError'
	}
}

/**
 * Google SRE adaptive throttle. Tracks a rolling window of total requests vs. backend-accepted
 * requests; sheds load locally when the accept rate falls behind.
 */
export class AdaptiveThrottle {
	private requests = 0
	private accepts = 0

	constructor(private readonly k = 2) {} // K=2 ⇒ allow ~2× the accept rate before shedding

	/** p = max(0, (requests − K·accepts) / (requests + 1)). 0 when healthy, climbs under rejection. */
	rejectProbability(): number {
		return Math.max(0, (this.requests - this.k * this.accepts) / (this.requests + 1))
	}

	/** Roll the window so old rejection history decays (call periodically, e.g. per 60s tick). */
	decay(factor = 0.5): void {
		this.requests *= factor
		this.accepts *= factor
	}

	/**
	 * Run `fn` through the throttle. Drops locally (ThrottledError) with the computed probability
	 * BEFORE making the call, so a sick backend isn't hammered. Counts accepts on success.
	 */
	async run<T>(fn: () => Promise<T>): Promise<T> {
		this.requests += 1
		if (Math.random() < this.rejectProbability()) throw new ThrottledError() // shed before the wire
		const result = await fn() // a thrown error here is NOT an accept — accepts only counts success
		this.accepts += 1
		return result
	}
}

/** Exponential backoff with full jitter (AWS "Exponential Backoff And Jitter"). */
export function backoffWithJitter(attempt: number, baseMs = 100, capMs = 10_000): number {
	const exp = Math.min(capMs, baseMs * 2 ** attempt)
	return Math.random() * exp // full jitter — desynchronize a thundering herd of retriers
}

/**
 * Retry helper combining backoff + jitter. Each attempt gets its own deadline (RESIL-4) so a
 * hung call can't stall the whole retry loop. Caps attempts — an LLM-driven loop must be bounded
 * (compounds AGENT-W denial-of-wallet).
 */
export async function retryWithBackoff<T>(
	fn: (signal: AbortSignal) => Promise<T>,
	opts: { maxAttempts?: number; perAttemptTimeoutMs?: number } = {},
): Promise<T> {
	const maxAttempts = opts.maxAttempts ?? 4
	const perAttemptTimeoutMs = opts.perAttemptTimeoutMs ?? 2_000
	let lastErr: unknown
	for (let attempt = 0; attempt < maxAttempts; attempt++) {
		const controller = new AbortController()
		const timer = setTimeout(() => controller.abort(), perAttemptTimeoutMs) // RESIL-4 deadline
		try {
			return await fn(controller.signal)
		} catch (err) {
			lastErr = err // log + retry; never silently swallow (FAIL-1)
			if (attempt < maxAttempts - 1) await sleep(backoffWithJitter(attempt))
		} finally {
			clearTimeout(timer)
		}
	}
	throw lastErr // exhausted attempts → surface the failure, don't return a stale fallback
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms))
}

/* ── Timeout budget note (RESIL-4) ────────────────────────────────────────────────────────
 *
 * Backoff is only safe if each attempt is bounded. The END-TO-END request budget is the SUM of
 * its hops' deadlines, and it must be enforced at the top of the synchronous tool path:
 *
 *   budget = perAttemptTimeoutMs × maxAttempts + Σ backoff
 *
 * If that sum exceeds the caller's deadline, you'll exhaust the bulkhead under load before the
 * retries finish. Size `maxAttempts` and `perAttemptTimeoutMs` so the worst-case total fits the
 * request budget — and wrap the whole foreground path in one outer `AbortSignal.timeout(budget)`.
 */
