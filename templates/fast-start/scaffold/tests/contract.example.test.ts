/**
 * contract.example.test.ts — write→read round-trip contract test + seam-registry idea.
 *
 * PREVENTS:
 *   SEAM-2 (writer→reader contract matrix not enumerated): for every write entry point this
 *          asserts the value SURVIVES the round trip through a DIFFERENT read path. A write
 *          with no consuming read — or a read that drops the field — fails here (Stryde:
 *          log_subjective wrote mood/soreness/RPE that no read tool surfaced for weeks).
 *
 * The SEAM REGISTRY idea: every row in the INV-2 matrix (ARCHITECTURE_INVARIANTS.md) gets an
 * entry in SEAM_CONTRACTS below and a test that drives write→read through the real storage
 * layer (NO mocked DB — FAIL-3). A new write entry point isn't "done" until its registry row
 * + round-trip test exist and pass.
 *
 * Copy-then-edit: replace the example write/read with your tools and a REAL test DB handle.
 * vitest shown; jest is the same with `test`/`expect`.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { normalizeInput } from '../contract/boundary'

// ── Seam registry — the SEAM-2 matrix as code ───────────────────────────────────────────
// One row per writer→reader contract. Keep in sync with INV-2 in ARCHITECTURE_INVARIANTS.md.
interface SeamContract {
	id: string
	writer: string // write entry point
	tables: string[] // tables written
	reader: string // read path that consumes (MUST be a different path than the writer)
	field: string // the field whose survival proves the contract
}

export const SEAM_CONTRACTS: SeamContract[] = [
	{
		id: 'metric_roundtrip',
		writer: 'logMetric',
		tables: ['metrics'],
		reader: 'getMetricHistory',
		field: 'metricType',
	},
	// Add a row for every write entry point. A writer with no reader row is a SEAM-2 black hole.
]

// ── Real storage handle — NO mocks (FAIL-3) ─────────────────────────────────────────────
// Replace with your project's test DB connection seeded from the prod-schema snapshot (MIG-4).
// import { testDb, logMetric, getMetricHistory } from '../../src/storage'

beforeAll(async () => {
	// await testDb.connect(); await testDb.reset()  // per-test isolation (QA-3)
})
afterAll(async () => {
	// await testDb.close()
})

describe('SEAM-2 write→read round-trip', () => {
	it('every seam contract has a writer, a DIFFERENT reader, and a field', () => {
		for (const c of SEAM_CONTRACTS) {
			expect(c.writer).not.toEqual(c.reader) // round-trip must cross a seam, not echo
			expect(c.field.length).toBeGreaterThan(0)
		}
	})

	it('metric written under an alias is read back as the canonical id', async () => {
		// 1. WRITE — through the boundary (canonicalizes "hrv_rmssd" → "HRV").
		const normalized = normalizeInput({ metricType: 'hrv_rmssd', value: 62, measuredOn: '2026-06-29' })

		// const written = await logMetric({ ownerId: 'test-owner', ...normalized })

		// 2. READ — through a DIFFERENT path. The value must survive.
		// const history = await getMetricHistory({ ownerId: 'test-owner', metricType: 'HRV' })
		// const found = history.find((h) => h.measuredOn === '2026-06-29')

		// 3. ASSERT the round-trip: the read path surfaces what the write path stored, as the
		//    SAME canonical id. This is the assertion that catches SEAM-1/SEAM-2 drift.
		// expect(found).toBeDefined()
		// expect(found?.metricType).toBe('HRV')      // not "hrv_rmssd" — canonicalized
		// expect(found?.value).toBe(62)

		// Until wired to real storage, assert the boundary half so the file runs green:
		expect(normalized.metricType).toBe('HRV')
		expect(normalized.value).toBe(62)
	})
})
