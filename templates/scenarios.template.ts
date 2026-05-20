/**
 * TEMPLATE — copy to your project as tests/qa/fixtures/scenarios.ts
 * Replace tool names, args, and assertions with your project's specifics.
 */

import type { QAScenario } from 'agentic-patterns/qa-framework';

const TODAY = new Date().toISOString().slice(0, 10);

export const SCENARIOS: QAScenario[] = [
	// ─── Contract: write → read round-trip ───────────────────────────────────
	{
		id: 'C-1',
		description: 'Create entity → readable via get tool',
		tags: ['contract', 'round-trip'],
		steps: [
			{
				tool: 'create_entity',   // ← replace with your write tool
				args: { type: 'TYPE_A', value: 42, date: TODAY, confirmed: true },
			},
			{
				tool: 'get_entity',      // ← replace with your read tool
				args: { type: 'TYPE_A', days: 1 },
			},
		],
		assert: (results) => {
			const read = results[1] as { records?: { value: number }[] };
			const found = read.records?.some(r => r.value === 42) ?? false;
			return {
				pass: found,
				message: found
					? 'Record found with correct value'
					: `Record not found. Response: ${JSON.stringify(read)}`,
			};
		},
	},

	// ─── Contract: alias normalisation ───────────────────────────────────────
	{
		id: 'C-2',
		description: 'Raw alias written → canonical type queryable',
		tags: ['contract', 'normalization'],
		steps: [
			{
				// Write using a raw external alias (e.g. from a screenshot or external source)
				tool: 'create_entity',
				args: { type: 'external_alias_for_type_a', value: 99, date: TODAY, confirmed: true },
			},
			{
				// Query using the canonical type — must find the record
				tool: 'get_entity',
				args: { type: 'TYPE_A', days: 1 },
			},
		],
		assert: (results) => {
			const read = results[1] as { records?: { value: number }[] };
			const found = read.records?.some(r => r.value === 99) ?? false;
			return {
				pass: found,
				message: found
					? 'Alias normalised correctly — canonical query found record'
					: `Alias not normalised. Canonical query returned: ${JSON.stringify(read)}`,
			};
		},
	},

	// ─── Safety gate: write blocked when condition active ────────────────────
	{
		id: 'C-3',
		description: 'Active condition → write tool blocked',
		tags: ['safety', 'gate'],
		steps: [
			{
				tool: 'activate_condition',  // ← replace with your gate-trigger tool
				args: { reason: 'QA test condition', confirmed: true },
			},
			{
				tool: 'create_entity',
				args: { type: 'TYPE_A', value: 1, date: TODAY, confirmed: true },
				expectErrorCode: 'SAFETY_SHELL_BLOCKED',  // ← replace with your error code
			},
		],
		assert: (results) => {
			// step 1 (write attempt) should have been caught by expectErrorCode above
			// if we reach assert, the setup step passed
			return { pass: true, message: 'Condition activated successfully' };
		},
	},

	// ─── Safety gate: read passes through when condition active ──────────────
	{
		id: 'C-4',
		description: 'Active condition → read tool still accessible',
		tags: ['safety', 'gate'],
		steps: [
			{
				tool: 'activate_condition',
				args: { reason: 'QA test condition', confirmed: true },
			},
			{
				tool: 'get_entity',   // read tool — must NOT be blocked
				args: { type: 'TYPE_A', days: 7 },
			},
		],
		assert: (results) => {
			const read = results[1] as { error?: unknown };
			const blocked = !!read?.error;
			return {
				pass: !blocked,
				message: !blocked
					? 'Read tool accessible with active condition'
					: `Read tool was blocked — should be exempt. Error: ${JSON.stringify(read.error)}`,
			};
		},
	},
];
