import type { ToolCallTrace, ToolCaller } from './types.js';

/**
 * Wraps a ToolCaller to record every call with args, result, and duration.
 * Silent failures (200 with wrong data) are only visible through traces.
 */
export function withTracing(
	caller: ToolCaller,
	onTrace: (trace: ToolCallTrace) => void,
): ToolCaller {
	return {
		async call(tool, args) {
			const start = Date.now();
			const timestamp = new Date().toISOString();
			try {
				const result = await caller.call(tool, args);
				const trace: ToolCallTrace = {
					tool,
					args,
					result,
					durationMs: Date.now() - start,
					timestamp,
				};
				onTrace(trace);
				return result;
			} catch (e: unknown) {
				const trace: ToolCallTrace = {
					tool,
					args,
					result: null,
					durationMs: Date.now() - start,
					timestamp,
					error: e,
				};
				onTrace(trace);
				throw e;
			}
		},
	};
}

/**
 * Creates a ToolCaller that calls a live MCP server over HTTP (JSON-RPC 2.0).
 */
export function createHttpToolCaller(
	serverUrl: string,
	testUserId: string,
	apiKey: string,
): ToolCaller {
	let requestId = 0;

	return {
		async call(tool, args) {
			const res = await fetch(`${serverUrl}/api/mcp`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${apiKey}`,
					'X-Test-User-Id': testUserId,
				},
				body: JSON.stringify({
					jsonrpc: '2.0',
					method: 'tools/call',
					params: { name: tool, arguments: args },
					id: ++requestId,
				}),
			});

			if (!res.ok) {
				throw new Error(`HTTP ${res.status} from ${tool}: ${await res.text()}`);
			}

			const body = await res.json() as { result?: unknown; error?: { code: number; message: string; data?: unknown } };

			if (body.error) {
				// Return error as value rather than throwing — probes need to assert error shape
				return { error: body.error };
			}

			return body.result;
		},
	};
}
