/**
 * TEMPLATE — copy to your project as tests/qa/fixtures/probes.ts
 * Replace tool names with your project's specifics.
 */

import type { QAProbe } from 'agentic-patterns/qa-framework';

export const PROBES: QAProbe[] = [
	// ─── Confirmation token cannot be replayed ────────────────────────────────
	{
		id: 'PROBE-01',
		description: 'Confirmation token is single-use — replay is rejected',
		setup: async (tools) => {
			// Get a confirmation token from the first call
			const preview = await tools.call('delete_entity', { id: 'test-entity-123' }) as { confirmationToken?: string };
			return { token: preview.confirmationToken ?? '' };
		},
		probe: async (tools, { token }) => {
			await tools.call('delete_entity', { confirmationToken: token }); // first use
			return tools.call('delete_entity', { confirmationToken: token }); // replay
		},
		assert: (result) => {
			const r = result as { error?: { message: string } };
			const rejected = r?.error?.message === 'TOKEN_EXPIRED_OR_USED';
			return {
				pass: rejected,
				message: rejected
					? 'Replayed token correctly rejected'
					: `Replayed token was accepted — tokens must be single-use. Got: ${JSON.stringify(r)}`,
			};
		},
	},

	// ─── Unknown type emits warn log, not silent drop ─────────────────────────
	{
		id: 'PROBE-02',
		description: 'Unknown entity type emits WARN log — not silently dropped',
		probe: async (tools) => {
			return tools.call('create_entity', {
				type: 'completely_unknown_type_xyz_qa_test',
				value: 42,
				date: new Date().toISOString().slice(0, 10),
				confirmed: true,
			});
		},
		assert: (_result, logs) => {
			const warned = logs.some(
				l => l.level === 'warn' && l.event === 'unknown_entity_type_stored_raw',
			);
			return {
				pass: warned,
				message: warned
					? 'WARN log emitted for unknown type'
					: 'No WARN log for unknown type — silent drops hide new integration types',
			};
		},
	},

	// ─── Error responses must include resolution field ────────────────────────
	{
		id: 'PROBE-03',
		description: 'Validation error responses include a resolution field',
		probe: async (tools) => {
			// Send a deliberately invalid argument
			return tools.call('create_entity', {
				type: '',  // empty type — should fail validation
				value: 42,
				date: 'not-a-date',
				confirmed: true,
			});
		},
		assert: (result) => {
			const r = result as { error?: { message: string; data?: { resolution?: string } } };
			const hasResolution = !!r?.error?.data?.resolution;
			return {
				pass: hasResolution,
				message: hasResolution
					? 'Error includes resolution field'
					: `Error missing resolution — LLM cannot self-correct. Got: ${JSON.stringify(r?.error)}`,
			};
		},
	},

	// ─── Condition resolves — write tools unblock ─────────────────────────────
	{
		id: 'PROBE-04',
		description: 'Resolved condition → write tools unblock',
		setup: async (tools) => {
			const condition = await tools.call('activate_condition', {
				reason: 'QA unblock test',
				confirmed: true,
			}) as { id: string };
			return { conditionId: condition.id };
		},
		probe: async (tools, { conditionId }) => {
			await tools.call('resolve_condition', { id: conditionId, confirmed: true });
			return tools.call('create_entity', {
				type: 'TYPE_A',
				value: 1,
				date: new Date().toISOString().slice(0, 10),
				confirmed: true,
			});
		},
		assert: (result) => {
			const r = result as { error?: unknown };
			const blocked = !!r?.error;
			return {
				pass: !blocked,
				message: !blocked
					? 'Write tool unblocked after condition resolved'
					: `Write tool still blocked after resolution. Error: ${JSON.stringify(r.error)}`,
			};
		},
	},
];
