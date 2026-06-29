/**
 * canonical-ids.ts — the canonical-id + alias-map pattern with an isCanonical guard.
 *
 * PREVENTS:
 *   SEAM-1  (write-alias / read-canonical drift): one canonical space, branded so the
 *           compiler rejects a raw string written downstream. Write and read reference the
 *           SAME constant — they can't drift apart.
 *   SEAM-3  (new enum added in one place, not all): the alias map is the single source of
 *           truth; totality/surjectivity property tests (property.example.test.ts) fail the
 *           moment an alias maps to nothing or a canonical is unreachable.
 *   AGENT-A (model extends its own category space): toCanonical() REJECTS unknown values
 *           instead of absorbing them — the model cannot introduce a category the
 *           persistence layer has never seen.
 *
 * Copy-then-edit: replace the example metric types with your domain's canonical set.
 */

// ── 1. Canonical set — the fixed category space (build-time, not runtime) ───────────────
// Add a variant here and EVERY downstream switch must handle it (the `never` default below
// makes that a compile error). This is the AGENT-A / SEAM-3 anchor.
export const CANONICAL_IDS = ['HEART_RATE', 'HRV', 'SLEEP_HOURS', 'VO2_MAX'] as const

export type CanonicalId = (typeof CANONICAL_IDS)[number]

// ── 2. Brand — so a raw string can't be written where a CanonicalId is required ─────────
// The DB write layer accepts `Canonical` only; a plain `string` is a compile error. This is
// what keeps SEAM-1 from happening: there is no way to write a non-canonical value.
export type Canonical = CanonicalId & { readonly __brand: 'CanonicalId' }

const CANONICAL_SET: ReadonlySet<string> = new Set(CANONICAL_IDS)

/** Type guard: is this string already a canonical id? */
export function isCanonical(value: string): value is CanonicalId {
	return CANONICAL_SET.has(value)
}

// ── 3. Alias map — every external/LLM spelling → its canonical id ───────────────────────
// One entry per known variant from every data source AND every alias the LLM might send.
// Keys are lowercased for case-insensitive lookup (see toCanonical). Edit for your sources.
export const ALIAS_TO_CANONICAL: Readonly<Record<string, CanonicalId>> = {
	// HEART_RATE
	heart_rate: 'HEART_RATE',
	heartrate: 'HEART_RATE',
	hr: 'HEART_RATE',
	bpm: 'HEART_RATE',
	// HRV  — the classic SEAM-1 trap: source writes rmssd, gate reads HRV
	hrv: 'HRV',
	hrv_rmssd: 'HRV',
	rmssd: 'HRV',
	// SLEEP_HOURS
	sleep_hours: 'SLEEP_HOURS',
	sleep: 'SLEEP_HOURS',
	sleepduration: 'SLEEP_HOURS',
	// VO2_MAX — note both spellings map here (the SEAM-3 trap was VO2MAX vs VO2_MAX)
	vo2_max: 'VO2_MAX',
	vo2max: 'VO2_MAX',
}

/**
 * Canonicalize an external value. Returns the branded canonical id, or null if unknown.
 * Callers at the boundary MUST handle null by rejecting (AGENT-A) — never store the raw
 * value. See boundary.ts for the dispatch-edge wiring.
 */
export function toCanonical(raw: string): Canonical | null {
	const key = raw.trim().toLowerCase()
	if (isCanonical(raw)) return raw as Canonical // already canonical → idempotent
	const mapped = ALIAS_TO_CANONICAL[key]
	return mapped ? (mapped as Canonical) : null
}

/** Brand a value already proven canonical (e.g. read back from a branded DB column). */
export function asCanonical(value: CanonicalId): Canonical {
	return value as Canonical
}

/**
 * Exhaustive handling example — SEAM-3 in action. Adding a new CanonicalId without adding a
 * case here is a COMPILE error (the `never` assignment), not a silent runtime drop.
 */
export function unitFor(id: CanonicalId): string {
	switch (id) {
		case 'HEART_RATE':
			return 'bpm'
		case 'HRV':
			return 'ms'
		case 'SLEEP_HOURS':
			return 'hours'
		case 'VO2_MAX':
			return 'ml/kg/min'
		default: {
			const _exhaustive: never = id
			throw new Error(`unhandled canonical id: ${String(_exhaustive)}`)
		}
	}
}
