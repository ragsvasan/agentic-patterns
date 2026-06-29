/**
 * boundary.ts — the Zod dispatch-boundary normalizer.
 *
 * PREVENTS:
 *   SEAM-1     (write-alias / read-canonical drift): canonicalization happens HERE, once,
 *              before any business code runs. Business code + DB only ever see canonical
 *              forms, so write and read can't drift apart.
 *   BOUNDARY-1 (validation not at the entry boundary): the schema parses untrusted input at
 *              the handler edge. Helpers downstream trust the parsed result and never
 *              re-validate or re-normalize.
 *   AGENT-A    (model extends its own category space): an unknown type is REJECTED with a
 *              structured error, never stored raw.
 *
 * Copy-then-edit: this is the single place every external value enters the system. Wire
 * every route/tool/CLI handler through normalizeInput() (or its schema) — see the §"wiring"
 * note at the bottom. A second normalization site is a SEAM-1 regression waiting to happen.
 */

import { z } from 'zod'
import { toCanonical, type Canonical } from './canonical-ids'

// ── The boundary schema ─────────────────────────────────────────────────────────────────
// `.transform` canonicalizes; `.superRefine` rejects unknown types with a structured error
// the caller can return verbatim (LLM clients self-correct from `resolution`; see
// UNIVERSAL_FIX_PATTERNS.md P-E1/P-E2 for the shared error shape).
export const MetricInputSchema = z
	.object({
		// Single-word param names are banned for domain concepts — use `metricType`, not `type`.
		metricType: z.string().min(1).describe('Metric type alias, e.g. "hrv_rmssd" or "HRV".'),
		value: z.number().finite().describe('Numeric value in the metric\'s canonical unit.'),
		// ISO date the value is for; the boundary owns date validation too (BOUNDARY-1).
		measuredOn: z
			.string()
			.regex(/^\d{4}-\d{2}-\d{2}$/, 'measuredOn must be YYYY-MM-DD')
			.describe('Date the metric was measured, e.g. "2026-06-29".'),
	})
	.transform((input, ctx) => {
		const canonical = toCanonical(input.metricType)
		if (canonical === null) {
			// AGENT-A / SEAM-3: do NOT absorb an unknown type — reject it.
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ['metricType'],
				message: `UNKNOWN_METRIC_TYPE: "${input.metricType}" is not a known alias. Add it to ALIAS_TO_CANONICAL or send a canonical id.`,
			})
			return z.NEVER
		}
		// Downstream sees ONLY the branded canonical id — SEAM-1 closed.
		return { metricType: canonical, value: input.value, measuredOn: input.measuredOn }
	})

/** The shape business code + the DB layer receive. `metricType` is branded canonical. */
export interface NormalizedMetric {
	metricType: Canonical
	value: number
	measuredOn: string
}

/**
 * Normalize raw input at the boundary. Throws a ZodError (catch at the handler and map to a
 * structured tool error per UNIVERSAL_FIX_PATTERNS.md). Returns a value safe for every
 * downstream consumer — no helper should ever call toCanonical() again.
 */
export function normalizeInput(raw: unknown): NormalizedMetric {
	return MetricInputSchema.parse(raw) as NormalizedMetric
}

/* ── Wiring (do this for EVERY entry point — SEAM-1 / BOUNDARY-1) ─────────────────────────
 *
 *   // route/tool handler — FIRST thing after auth (auth is line 1; BOUNDARY-2):
 *   const metric = normalizeInput(req.body)      // parse + canonicalize at the edge
 *   await db.insertMetric(metric)                // db layer accepts Canonical only
 *
 * Never access req.body.metricType directly, and never normalize a second time downstream.
 * If a read path has to re-normalize, the write path is broken (SEAM-1).
 */
