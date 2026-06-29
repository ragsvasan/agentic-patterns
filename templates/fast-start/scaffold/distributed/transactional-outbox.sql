-- transactional-outbox.sql — the outbox table + a partial index for the publisher poller.
--
-- PREVENTS:
--   DIST-1 (dual write with no atomicity): the lost-write / orphan problem. Writing the
--          business row and THEN calling a second service/queue is two operations with no
--          shared transaction — a crash between them leaves the two stores permanently
--          divergent with nothing to roll back (Stryde records biometrics, then calls Mnemo
--          to update recovery state; a crash between the two leaves them inconsistent).
--
-- The pattern: write the business row AND an event row into `outbox` in the SAME ACID
-- transaction (see outbox-publisher.example.ts). A separate publisher tails the WAL — or, in
-- the simple form here, polls `WHERE processed = false` — and forwards the event with
-- at-least-once delivery. The external call is decoupled from the user's transaction; nothing
-- is lost on partial failure.
--
-- Copy-then-edit: add this migration IN-BAND, same commit as the publisher (MIG-2). Both
-- columns below are NOT NULL with no DEFAULT — every INSERT must supply them (MIG-3).

CREATE TABLE outbox (
    id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    -- The event's stable, globally-unique id. The CONSUMER dedupes on this (DIST-3) — so it
    -- must be deterministic for a given logical event, not re-rolled on a publisher retry.
    event_id       uuid        NOT NULL UNIQUE,
    event_type     text        NOT NULL,           -- e.g. 'recovery_state.updated'
    aggregate_id   text        NOT NULL,           -- the business entity this event is about
    payload        jsonb       NOT NULL,           -- the event body the consumer applies
    processed      boolean     NOT NULL DEFAULT false,
    created_at     timestamptz NOT NULL DEFAULT now(),
    processed_at   timestamptz                     -- set when the publisher forwards it
);

-- Partial index: the poller only ever scans unprocessed rows. As `processed` rows accumulate,
-- a partial index keeps the publisher's `WHERE processed = false ORDER BY id` query fast and
-- small — it indexes only the live backlog, not the full history.
CREATE INDEX outbox_unprocessed_idx
    ON outbox (id)
    WHERE processed = false;

-- ── Publisher poll query (what outbox-publisher.example.ts runs) ───────────────────────────
-- SELECT ... FROM outbox
--   WHERE processed = false
--   ORDER BY id
--   LIMIT 100
--   FOR UPDATE SKIP LOCKED;        -- SKIP LOCKED ⇒ multiple publisher workers don't collide
--
-- After a successful forward, in the same poller transaction:
-- UPDATE outbox SET processed = true, processed_at = now() WHERE id = $1;
--
-- NOTE: delivery is at-least-once — a crash AFTER forwarding but BEFORE the UPDATE re-sends the
-- event. That is by design; the CONSUMER must be idempotent on event_id (DIST-3). Never try to
-- make this exactly-once at the publisher — make the consumer safe instead.
