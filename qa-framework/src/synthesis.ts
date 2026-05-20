import type { QAReport } from './types.js';

/**
 * Returns the synthesis agent prompt for a completed QA run.
 * Feed this to an LLM (e.g. Claude) to get adversarial analysis.
 *
 * The synthesis agent looks for:
 * - Silent failures (200 with wrong data — not caught by pass/fail alone)
 * - Coverage gaps (entity types or tool pairs with no test)
 * - Untested assumptions (questions no current test verifies)
 * - Error responses missing a 'resolution' field
 */
export function buildSynthesisPrompt(report: QAReport, coverageTable: string): string {
	const tracesSummary = [
		...report.scenarioResults.flatMap(r => r.traces),
		...report.probeResults.flatMap(r => r.traces),
	]
		.map(t => `${t.tool}(${JSON.stringify(t.args)}) → ${JSON.stringify(t.result)} (${t.durationMs}ms)`)
		.join('\n');

	const failures = [
		...report.scenarioResults.filter(r => !r.pass).map(r => `SCENARIO ${r.scenarioId}: ${r.message}`),
		...report.probeResults.filter(r => !r.pass).map(r => `PROBE ${r.probeId}: ${r.message}`),
	].join('\n') || 'None';

	return `You are an adversarial QA engineer reviewing an automated test run against a headless MCP server.

## Test Run Summary
- Run at: ${report.runAt}
- Environment: ${report.environment}
- Scenarios: ${report.summary.scenariosPassed} passed, ${report.summary.scenariosFailed} failed
- Probes: ${report.summary.probesPassed} passed, ${report.summary.probesFailed} failed

## Failures
${failures}

## Full Tool Call Trace
${tracesSummary}

## Coverage Table
${coverageTable}

## Your Job

1. Identify any **silent failures** — tool calls that returned 200 but the data looks wrong or inconsistent with what was written.

2. Identify **coverage gaps** — entity types, tool pairs, or failure modes in the coverage table that have no test.

3. Ask **three questions** about system assumptions that no current test verifies. These should be specific and actionable (e.g. "Does the safety gate unblock after the condition is resolved, or does it stay blocked?").

4. Flag any **error response** in the trace that lacks a 'resolution' field — those are errors the LLM client cannot act on.

Do NOT summarize what passed. Focus entirely on what failed, what is untested, and what could fail that has not been considered.`;
}
