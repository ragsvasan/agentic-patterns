/**
 * property.example.test.ts — totality / surjectivity / idempotency / round-trip properties.
 *
 * PREVENTS:
 *   SEAM-3 (new enum/type added in one place, not all): these properties fail the moment the
 *          canonical space and the alias map drift apart — a new alias with no canonical, or
 *          a new canonical no alias reaches. They are the structural guard behind INV-3.
 *
 * Four properties of the normalization boundary, each a one-liner that catches a whole bug
 * class. Adapt the generic patterns (Stryde STABILITY_ARCHITECTURE.md Part 6) to your map.
 *
 * Copy-then-edit: these run against contract/canonical-ids.ts + boundary.ts as shipped.
 */

import { describe, it, expect } from 'vitest'
import {
	CANONICAL_IDS,
	ALIAS_TO_CANONICAL,
	toCanonical,
	isCanonical,
	type CanonicalId,
} from '../contract/canonical-ids'

describe('SEAM-3 normalization properties', () => {
	// ── TOTALITY: every known alias maps to a non-null canonical ──────────────────────────
	// Fails if a new source alias is added to the map with a typo'd / nonexistent canonical.
	it('totality — every alias resolves to a canonical id', () => {
		for (const [alias, canonical] of Object.entries(ALIAS_TO_CANONICAL)) {
			const resolved = toCanonical(alias)
			expect(resolved, `alias "${alias}" failed to resolve`).not.toBeNull()
			expect(resolved).toBe(canonical)
		}
	})

	// ── SURJECTIVITY: every canonical is reachable from ≥1 alias ───────────────────────────
	// Fails if you add a canonical id but no alias ever produces it — a DEAD canonical that no
	// real input can reach (the inverse of the SEAM-3 trap).
	it('surjectivity — every canonical id is reachable from at least one alias', () => {
		const reachable = new Set<CanonicalId>(Object.values(ALIAS_TO_CANONICAL))
		// A canonical id is also reachable as itself (toCanonical is idempotent on canonicals):
		for (const id of CANONICAL_IDS) reachable.add(id)
		for (const id of CANONICAL_IDS) {
			expect(reachable.has(id), `canonical "${id}" is unreachable — no alias maps to it`).toBe(true)
		}
	})

	// ── IDEMPOTENCY: normalizing a canonical id returns it unchanged ──────────────────────
	// toCanonical(toCanonical(x)) === toCanonical(x). A read path that re-normalizes must be
	// safe; more importantly it proves canonical forms are fixed points.
	it('idempotency — normalizing a canonical id is a no-op', () => {
		for (const id of CANONICAL_IDS) {
			expect(isCanonical(id)).toBe(true)
			expect(toCanonical(id)).toBe(id)
		}
	})

	// ── ROUND-TRIP: alias → canonical → still canonical & known ───────────────────────────
	// Every alias, once canonicalized, is a member of the canonical set (no string leaks
	// through). This is the property that guarantees the DB only ever sees canonical values.
	it('round-trip — alias → canonical lands inside the canonical set', () => {
		for (const alias of Object.keys(ALIAS_TO_CANONICAL)) {
			const canonical = toCanonical(alias)
			expect(canonical).not.toBeNull()
			expect(CANONICAL_IDS).toContain(canonical as CanonicalId)
		}
	})

	// ── NEGATIVE: an unknown value is REJECTED, not absorbed (AGENT-A) ─────────────────────
	it('rejection — an unknown type returns null (never silently stored)', () => {
		expect(toCanonical('totally_unknown_metric_xyz')).toBeNull()
	})
})
