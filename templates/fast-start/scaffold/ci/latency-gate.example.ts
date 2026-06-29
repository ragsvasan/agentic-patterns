/**
 * latency-gate.example.ts — hot-path latency gate stub.
 *
 * PREVENTS:
 *   PERF-1 (blocking call introduced into the hot path): one synchronous loopback dropped
 *          into a per-request path is a latency cliff for EVERY call (Mnemo: a single GET /me
 *          loopback added 12,291 ms to every MCP tool call; no gate caught it). This gate is
 *          the thing that catches it — runs <30s locally, fails the build on regression.
 *
 * Thresholds (the standing budget): avg < 500 ms, p95 < 1000 ms.
 *
 * Copy-then-edit: replace `exerciseHotPath` with a real invocation of your per-request
 * critical path (auth verify, tool dispatch, the route handler) against a warm local server
 * or an in-process harness. Keep it dependency-light so it stays fast.
 */

const ITERATIONS = 50
const AVG_BUDGET_MS = 500
const P95_BUDGET_MS = 1000

/** Replace with your real hot path. Must exercise the SAME code path a request hits. */
async function exerciseHotPath(): Promise<void> {
	// e.g. await dispatchTool('getMetricHistory', { ownerId: 'bench', metricType: 'HRV' })
	// Stub: a trivial async tick so the gate is runnable as shipped.
	await Promise.resolve()
}

function percentile(sortedMs: number[], p: number): number {
	const idx = Math.min(sortedMs.length - 1, Math.ceil((p / 100) * sortedMs.length) - 1)
	return sortedMs[idx]
}

async function main(): Promise<void> {
	const samples: number[] = []
	// One warm-up iteration so we don't measure cold-start (PROC-3: measure steady state).
	await exerciseHotPath()

	for (let i = 0; i < ITERATIONS; i++) {
		const start = performance.now()
		await exerciseHotPath()
		samples.push(performance.now() - start)
	}

	samples.sort((a, b) => a - b)
	const avg = samples.reduce((s, x) => s + x, 0) / samples.length
	const p95 = percentile(samples, 95)

	// Terse output: command result is the source of truth.
	console.log(`latency-gate: n=${ITERATIONS} avg=${avg.toFixed(1)}ms p95=${p95.toFixed(1)}ms`)

	const failures: string[] = []
	if (avg >= AVG_BUDGET_MS) failures.push(`avg ${avg.toFixed(1)}ms >= ${AVG_BUDGET_MS}ms`)
	if (p95 >= P95_BUDGET_MS) failures.push(`p95 ${p95.toFixed(1)}ms >= ${P95_BUDGET_MS}ms`)

	if (failures.length > 0) {
		console.error(`PERF-1 latency gate FAILED: ${failures.join('; ')}`)
		process.exit(1)
	}
	console.log('PERF-1 latency gate passed.')
}

main().catch((err: unknown) => {
	// FAIL-1: never swallow — log + non-zero exit so CI goes red.
	console.error('latency gate errored:', err instanceof Error ? err.message : String(err))
	process.exit(1)
})
