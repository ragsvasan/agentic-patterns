/**
 * idempotency.ts — idempotency-key helper for write tools.
 *
 * PREVENTS:
 *   AGENT-I (no idempotency key on a write): LLM clients retry on TIMEOUT, not just on
 *           network error, so one logical action gets written twice (Stryde: log_workout
 *           double-wrote; load math counted two real sessions). The model did exactly what
 *           it was told — the missing structure is the bug.
 *
 * The contract: every write tool accepts an optional idempotency_key. If omitted, derive it
 * from a stable hash of the meaningful input. Store it with a UNIQUE constraint; on conflict,
 * return the EXISTING record rather than writing again.
 *
 * Copy-then-edit: swap the example fields for your write tool's inputs.
 */

import { createHash } from 'node:crypto'

/**
 * Derive a deterministic idempotency key from the meaningful fields of a write. Two
 * identical logical writes (e.g. a retry) produce the same key. Exclude volatile fields
 * (timestamps, request ids) — include only what makes the write logically unique.
 */
export function deriveIdempotencyKey(parts: Record<string, string | number | boolean>): string {
	// Stable stringify: sort keys so field order doesn't change the hash.
	const canonical = Object.keys(parts)
		.sort()
		.map((k) => `${k}=${String(parts[k])}`)
		.join('&')
	return createHash('sha256').update(canonical).digest('hex')
}

/** Resolve the effective key: caller-supplied wins, else derive from input. */
export function resolveIdempotencyKey(
	supplied: string | undefined,
	parts: Record<string, string | number | boolean>,
): string {
	return supplied && supplied.trim().length > 0 ? supplied.trim() : deriveIdempotencyKey(parts)
}

/*
 * ── DB side (the half that actually enforces idempotency) ────────────────────────────────
 *
 * 1. UNIQUE constraint on the key, scoped to the owner (BOUNDARY-4 — never global):
 *
 *      -- migration (in-band, same commit as the write tool — MIG-2)
 *      ALTER TABLE workouts
 *        ADD COLUMN idempotency_key text NOT NULL;
 *      CREATE UNIQUE INDEX workouts_owner_idem_uq
 *        ON workouts (owner_id, idempotency_key);
 *
 *    NOTE (MIG-3): idempotency_key is NOT NULL with no DEFAULT — every INSERT INTO workouts
 *    must supply it. Grep every insert site before shipping, or the migration breaks new rows.
 *
 * 2. INSERT ... ON CONFLICT DO NOTHING / RETURNING, then read-back on conflict — so a retry
 *    returns the original record instead of erroring or double-writing:
 *
 *      const key = resolveIdempotencyKey(input.idempotency_key, {
 *        ownerId, type: metric.metricType, value: metric.value, on: metric.measuredOn,
 *      })
 *      const inserted = await db
 *        .insertInto('workouts')
 *        .values({ ...row, owner_id: ownerId, idempotency_key: key })
 *        .onConflict((oc) => oc.columns(['owner_id', 'idempotency_key']).doNothing())
 *        .returningAll()
 *        .executeTakeFirst()
 *      // On conflict `inserted` is undefined → read the existing row and return THAT:
 *      const record = inserted ?? (await db.selectFrom('workouts')
 *        .where('owner_id', '=', ownerId)
 *        .where('idempotency_key', '=', key)
 *        .selectAll().executeTakeFirstOrThrow())
 *      return record   // identical response whether first call or retry
 *
 * Drizzle note: a deployed partial/unique index needs onConflictDoUpdate with a matching
 * `target` + `targetWhere`, or you get a 42P10 "no unique constraint matching" error.
 */
