/**
 * outbox-publisher.example.ts — write entity + event in one tx; a separate poller forwards.
 *
 * PREVENTS:
 *   DIST-1 (dual write with no atomicity): the entity row and its event row are written in ONE
 *          ACID transaction (`writeWithOutbox` below). There is no window where the entity
 *          exists but the event was lost — the two either commit together or not at all.
 *   DIST-3 (at-least-once delivery, non-idempotent consumer): the publisher delivers each event
 *          AT LEAST once (a crash after forwarding but before marking processed re-sends it).
 *          The consumer (`applyEventIdempotently`) dedupes on `event_id`, so a double-delivery
 *          double-applies nothing.
 *
 * Two halves, deliberately decoupled:
 *   1. PRODUCER (`writeWithOutbox`) — runs inside the user's request. One transaction:
 *      business write + outbox insert. The external call is NOT here.
 *   2. PUBLISHER (`runPublisherOnce`) — a separate background loop. Polls unprocessed outbox
 *      rows, forwards each, marks them processed. The external call lives here, outside the
 *      user's transaction, with retries.
 *
 * Copy-then-edit: replace the `db`/`forwardEvent` stubs. Pairs with transactional-outbox.sql.
 * vitest-style types shown; adapt to your DB client (Drizzle/Kysely/pg).
 */

import { randomUUID } from 'node:crypto'

// Stand-ins for your real DB client + downstream forwarder — replace with project imports.
interface Tx {
	insertEntity(row: Record<string, unknown>): Promise<{ id: string }>
	insertOutbox(row: OutboxRow): Promise<void>
}
interface Db {
	transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T>
	claimUnprocessed(limit: number): Promise<OutboxRow[]> // SELECT ... FOR UPDATE SKIP LOCKED
	markProcessed(id: string): Promise<void>
	hasProcessedEvent(eventId: string): Promise<boolean>
	applyEvent(event: OutboxRow): Promise<void>
}
declare const db: Db
/** Forward to the second service/queue. Retried by the publisher; must be cancellable. */
declare function forwardEvent(event: OutboxRow, signal: AbortSignal): Promise<void>

export interface OutboxRow {
	event_id: string // stable, deterministic per logical event — the consumer dedupes on THIS (DIST-3)
	event_type: string
	aggregate_id: string
	payload: Record<string, unknown>
}

// ── 1. PRODUCER — entity + event in ONE transaction (DIST-1) ───────────────────────────────
/**
 * Write the business entity and its event atomically. NO external call here — that would
 * re-introduce the dual-write race. The event is durably queued in `outbox`; the publisher
 * forwards it later.
 */
export async function writeWithOutbox(
	entity: Record<string, unknown>,
	eventType: string,
): Promise<{ id: string; eventId: string }> {
	const eventId = randomUUID() // deterministic-per-event in real code (derive from the write's idem key)
	return db.transaction(async (tx) => {
		const { id } = await tx.insertEntity(entity)
		await tx.insertOutbox({
			event_id: eventId,
			event_type: eventType,
			aggregate_id: id,
			payload: { ...entity, id },
		})
		// Both commit together. A crash before commit ⇒ neither lands. No orphan, no lost event.
		return { id, eventId }
	})
}

// ── 2. PUBLISHER — separate loop, at-least-once forward (DIST-3) ───────────────────────────
/**
 * One publisher pass. Claims a batch of unprocessed rows, forwards each, marks it processed.
 * At-least-once by design: a crash between forward and markProcessed re-sends — that's why the
 * consumer must be idempotent. Run on an interval; FOR UPDATE SKIP LOCKED lets workers scale out.
 */
export async function runPublisherOnce(batchSize = 100): Promise<number> {
	const rows = await db.claimUnprocessed(batchSize)
	let forwarded = 0
	for (const row of rows) {
		const controller = new AbortController()
		const timer = setTimeout(() => controller.abort(), 2_000) // RESIL-4: bound each forward
		try {
			await forwardEvent(row, controller.signal)
			await db.markProcessed((row as OutboxRow & { id: string }).id)
			forwarded += 1
		} catch (err) {
			// Leave the row unprocessed — it retries next pass. Log, never swallow (FAIL-1).
			console.error(`outbox forward failed for event ${row.event_id}; will retry`, err)
		} finally {
			clearTimeout(timer)
		}
	}
	return forwarded
}

// ── CONSUMER — idempotent receiver (DIST-3) ────────────────────────────────────────────────
/**
 * The downstream side. Dedupe on event_id BEFORE applying. Assume every event can arrive twice
 * (publisher retries, network ambiguity). AGENT-I dedupes the producer's WRITE tool; this is the
 * separate, required dedupe of the resulting event STREAM.
 */
export async function applyEventIdempotently(event: OutboxRow): Promise<void> {
	if (await db.hasProcessedEvent(event.event_id)) return // already applied — skip (no double-charge)
	await db.applyEvent(event) // ideally an idempotent UPSERT keyed on event_id, so the dedupe is structural
}

/* ── Saga / compensation note (DIST-2) ────────────────────────────────────────────────────
 *
 * The outbox covers ONE logical write fanned out to a second store. When a single operation
 * spans SEVERAL writes across services that genuinely can't share a transaction, you need a
 * saga, not an outbox:
 *
 *   FIRST, try to collapse the writes into ONE ACID transaction — most "distributed" writes are
 *   actually same-database and don't need a saga at all. Only if they truly can't:
 *
 *   - Run each step as its own local transaction, in order (orchestrated by a state machine).
 *   - For each step, define a COMPENSATING transaction that undoes it.
 *   - On a mid-sequence failure (say step 3 of 4), run the compensations for steps 1–2 in
 *     reverse to unwind the committed work — leaving no orphaned half-applied state.
 *
 *   It's eventual consistency, not atomicity: design reads to tolerate the in-flight window.
 */
