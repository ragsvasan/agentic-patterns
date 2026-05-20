/**
 * TEMPLATE — copy to your project as tests/qa/fixtures/aliases.ts
 *
 * List every external alias your system should recognise — one entry per
 * known variant from every data source (integrations, MCP tool inputs, etc).
 *
 * Used by the normalization property test:
 *   it('every known alias normalizes to non-null', () => {
 *     for (const alias of ALL_KNOWN_ALIASES) {
 *       expect(normalizeType(alias)).not.toBeNull();
 *     }
 *   });
 *
 * This test fails the moment a new integration is added without updating the map.
 */

export const ALL_KNOWN_ALIASES = [
	// ── Source 1 (e.g. Apple HealthKit) ──────────────────────────────────────
	'ExternalSource1TypeA',
	'ExternalSource1TypeB',

	// ── Source 2 (e.g. Garmin) ───────────────────────────────────────────────
	'source2_type_a',
	'source2_type_b',

	// ── Source 3 (e.g. Whoop) ────────────────────────────────────────────────
	'SOURCE3_TYPE_A',
	'SOURCE3_TYPE_B',

	// ── MCP tool input aliases (what the LLM sends) ──────────────────────────
	'type_a',
	'typeA',
	'type-a',

	// ── Canonical forms — normalization must be idempotent ───────────────────
	'TYPE_A',
	'TYPE_B',
] as const;

export type KnownAlias = (typeof ALL_KNOWN_ALIASES)[number];
