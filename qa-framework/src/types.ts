// Core types for the adversarial QA framework.
// Project-specific fixtures implement these interfaces.

export interface QAStep {
	tool: string;
	args: Record<string, unknown>;
	/** If set, assert this error code is returned (step is expected to fail) */
	expectErrorCode?: string;
}

export interface AssertionResult {
	pass: boolean;
	message: string;
}

export interface QAScenario {
	id: string;
	description: string;
	/** Free-form tags for filtering: 'contract', 'normalization', 'safety', etc. */
	tags: string[];
	steps: QAStep[];
	assert: (results: unknown[]) => AssertionResult;
}

export interface QAProbeSetup {
	(tools: ToolCaller): Promise<Record<string, unknown>>;
}

export interface QAProbe {
	id: string;
	description: string;
	/** Optional setup step — runs before the probe, returns context passed to probe and assert */
	setup?: QAProbeSetup;
	probe: (tools: ToolCaller, setupContext: Record<string, unknown>) => Promise<unknown>;
	/** logs is the captured log entries emitted during the probe */
	assert: (result: unknown, logs: LogEntry[], setupContext: Record<string, unknown>) => AssertionResult;
}

export interface ToolCaller {
	call(tool: string, args: Record<string, unknown>): Promise<unknown>;
}

export interface LogEntry {
	level: 'debug' | 'info' | 'warn' | 'error';
	event: string;
	data: Record<string, unknown>;
	timestamp: string;
}

export interface ToolCallTrace {
	tool: string;
	args: Record<string, unknown>;
	result: unknown;
	durationMs: number;
	timestamp: string;
	error?: unknown;
}

export interface ScenarioResult {
	scenarioId: string;
	description: string;
	pass: boolean;
	message: string;
	traces: ToolCallTrace[];
	durationMs: number;
}

export interface ProbeResult {
	probeId: string;
	description: string;
	pass: boolean;
	message: string;
	traces: ToolCallTrace[];
	logs: LogEntry[];
	durationMs: number;
}

export interface QAReport {
	runAt: string;
	environment: string;
	scenarioResults: ScenarioResult[];
	probeResults: ProbeResult[];
	summary: {
		scenariosPassed: number;
		scenariosFailed: number;
		probesPassed: number;
		probesFailed: number;
	};
}

export interface QARunnerConfig {
	serverUrl: string;
	testUserId: string;
	apiKey: string;
	/** Called before each run to wipe test user state */
	resetState: (testUserId: string) => Promise<void>;
	/** Optional: capture server-side log entries during a run */
	captureLogs?: () => Promise<LogEntry[]>;
}
