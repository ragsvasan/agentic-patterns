import type {
	QAScenario,
	QAProbe,
	QAReport,
	QARunnerConfig,
	ScenarioResult,
	ProbeResult,
	ToolCallTrace,
} from './types.js';
import { withTracing } from './tracer.js';

export class QARunner {
	constructor(private readonly config: QARunnerConfig) {}

	async run(scenarios: QAScenario[], probes: QAProbe[]): Promise<QAReport> {
		const runAt = new Date().toISOString();

		await this.config.resetState(this.config.testUserId);

		const [scenarioResults, probeResults] = await Promise.all([
			this.runScenarios(scenarios),
			this.runProbes(probes),
		]);

		const report: QAReport = {
			runAt,
			environment: this.config.serverUrl,
			scenarioResults,
			probeResults,
			summary: {
				scenariosPassed: scenarioResults.filter(r => r.pass).length,
				scenariosFailed: scenarioResults.filter(r => !r.pass).length,
				probesPassed: probeResults.filter(r => r.pass).length,
				probesFailed: probeResults.filter(r => !r.pass).length,
			},
		};

		return report;
	}

	private async runScenarios(scenarios: QAScenario[]): Promise<ScenarioResult[]> {
		const results: ScenarioResult[] = [];

		for (const scenario of scenarios) {
			// Reset state between scenarios to prevent contamination
			await this.config.resetState(this.config.testUserId);

			const start = Date.now();
			const traces: ToolCallTrace[] = [];
			const stepResults: unknown[] = [];

			const { createHttpToolCaller } = await import('./tracer.js');
			const baseCaller = createHttpToolCaller(
				this.config.serverUrl,
				this.config.testUserId,
				this.config.apiKey,
			);
			const tracedCaller = withTracing(baseCaller, t => traces.push(t));

			try {
				for (const step of scenario.steps) {
					const result = await tracedCaller.call(step.tool, step.args);

					if (step.expectErrorCode) {
						const r = result as { error?: { message: string } };
						if (!r.error || r.error.message !== step.expectErrorCode) {
							results.push({
								scenarioId: scenario.id,
								description: scenario.description,
								pass: false,
								message: `Step ${step.tool}: expected error ${step.expectErrorCode}, got ${JSON.stringify(r.error ?? 'no error')}`,
								traces,
								durationMs: Date.now() - start,
							});
							break;
						}
					}

					stepResults.push(result);
				}

				const assertion = scenario.assert(stepResults);
				results.push({
					scenarioId: scenario.id,
					description: scenario.description,
					pass: assertion.pass,
					message: assertion.message,
					traces,
					durationMs: Date.now() - start,
				});
			} catch (e: unknown) {
				results.push({
					scenarioId: scenario.id,
					description: scenario.description,
					pass: false,
					message: `Unexpected error: ${e instanceof Error ? e.message : String(e)}`,
					traces,
					durationMs: Date.now() - start,
				});
			}
		}

		return results;
	}

	private async runProbes(probes: QAProbe[]): Promise<ProbeResult[]> {
		const results: ProbeResult[] = [];

		for (const probe of probes) {
			await this.config.resetState(this.config.testUserId);

			const start = Date.now();
			const traces: ToolCallTrace[] = [];

			const { createHttpToolCaller } = await import('./tracer.js');
			const baseCaller = createHttpToolCaller(
				this.config.serverUrl,
				this.config.testUserId,
				this.config.apiKey,
			);
			const tracedCaller = withTracing(baseCaller, t => traces.push(t));

			try {
				const setupContext = probe.setup ? await probe.setup(tracedCaller) : {};
				const result = await probe.probe(tracedCaller, setupContext);
				const logs = this.config.captureLogs ? await this.config.captureLogs() : [];
				const assertion = probe.assert(result, logs, setupContext);

				results.push({
					probeId: probe.id,
					description: probe.description,
					pass: assertion.pass,
					message: assertion.message,
					traces,
					logs,
					durationMs: Date.now() - start,
				});
			} catch (e: unknown) {
				results.push({
					probeId: probe.id,
					description: probe.description,
					pass: false,
					message: `Unexpected error: ${e instanceof Error ? e.message : String(e)}`,
					traces,
					logs: [],
					durationMs: Date.now() - start,
				});
			}
		}

		return results;
	}
}

/** Print a human-readable summary of a QA report to stdout */
export function printReport(report: QAReport): void {
	const { summary } = report;
	console.log(`\nQA Run — ${report.runAt}`);
	console.log(`Environment: ${report.environment}\n`);

	console.log('Scenarios:');
	for (const r of report.scenarioResults) {
		console.log(`  ${r.pass ? '✓' : '✗'} [${r.scenarioId}] ${r.description}`);
		if (!r.pass) console.log(`      → ${r.message}`);
	}

	console.log('\nProbes:');
	for (const r of report.probeResults) {
		console.log(`  ${r.pass ? '✓' : '✗'} [${r.probeId}] ${r.description}`);
		if (!r.pass) console.log(`      → ${r.message}`);
	}

	console.log(`\nResult: ${summary.scenariosPassed + summary.probesPassed} passed, ${summary.scenariosFailed + summary.probesFailed} failed`);

	if (summary.scenariosFailed + summary.probesFailed > 0) {
		process.exitCode = 1;
	}
}
