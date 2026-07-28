-- Until now a fact belonged to a piece of paper. A customer who gave the material in one email
-- and the area in the next was asked for both, twice, because every message was judged alone.
--
-- orders is what jobs was going to be. It was never populated — no row, no code reading it — so
-- this replaces it outright rather than migrating anything, and takes the vocabulary the design
-- documents already use.
--
-- order_events is the half that makes the rest defensible: every value written into an order
-- carries the message it came from, and every value overwritten leaves the old one behind. Six
-- months from now "where did 400 sq ft come from" has an answer.
--
-- Run this before deploying the nodes that write to it. In the other order every write fails.

BEGIN;

CREATE TABLE orders (
    id                    integer        GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    contact_email         text,
    thread_id             text,
    state                 text           NOT NULL DEFAULT 'new',

    material_category     text,
    area_sqft             numeric(10, 2),
    area_unit             text,
    city                  text,
    zone                  text,
    existing_floor_action text,
    fixing_method         text,
    old_floor_removal     boolean,
    flags                 jsonb          NOT NULL DEFAULT '{}'::jsonb,

    confirmed_at          timestamptz,
    closed_at             timestamptz,
    created_at            timestamptz    NOT NULL DEFAULT now(),
    updated_at            timestamptz    NOT NULL DEFAULT now(),

    CONSTRAINT orders_state_known CHECK (state IN (
        'new', 'needs_info', 'quoted', 'negotiating',
        'booked', 'done', 'lost', 'survey_needed')),
    CONSTRAINT orders_material_known CHECK (material_category IS NULL
        OR material_category IN ('LVP', 'Laminate', 'Wood', 'Vinyl', 'Carpet')),
    CONSTRAINT orders_area_unit_known CHECK (area_unit IS NULL
        OR area_unit IN ('sqft', 'sqm', 'sqyd')),
    CONSTRAINT orders_zone_known CHECK (zone IS NULL OR zone IN ('core', 'edge', 'out')),
    CONSTRAINT orders_floor_action_known CHECK (existing_floor_action IS NULL
        OR existing_floor_action IN ('remove_first', 'over_existing')),
    CONSTRAINT orders_fixing_known CHECK (fixing_method IS NULL OR fixing_method IN (
        'click_lock', 'floating', 'glue_down', 'nail_down', 'staple_down',
        'loose_lay', 'peel_and_stick', 'mortar_set', 'thinset')),
    CONSTRAINT orders_area_sane CHECK (area_sqft IS NULL
        OR (area_sqft > 0 AND area_sqft < 1000000)),
    CONSTRAINT orders_closed_is_stamped CHECK (
        (state IN ('booked', 'done', 'lost')) = (closed_at IS NOT NULL))
);

CREATE INDEX orders_thread_idx  ON orders (thread_id);
CREATE INDEX orders_contact_idx ON orders (lower(contact_email), created_at DESC);

CREATE TABLE order_events (
    id                integer     GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    order_id          integer     NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
    gmail_message_id  text,
    kind              text        NOT NULL,
    field             text,
    old_value         text,
    new_value         text,
    created_at        timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT order_events_kind_known CHECK (kind IN (
        'created', 'merged', 'corrected', 'state_change', 'approved', 'rejected'))
);

CREATE INDEX order_events_order_idx ON order_events (order_id, created_at);

ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_job_id_fkey;
ALTER TABLE messages RENAME COLUMN job_id TO order_id;
ALTER TABLE messages ADD CONSTRAINT messages_order_id_fkey
    FOREIGN KEY (order_id) REFERENCES orders (id) ON DELETE SET NULL;

ALTER TABLE offers DROP CONSTRAINT IF EXISTS offers_job_id_fkey;
ALTER TABLE offers RENAME COLUMN job_id TO order_id;
ALTER TABLE offers ADD CONSTRAINT offers_order_id_fkey
    FOREIGN KEY (order_id) REFERENCES orders (id) ON DELETE CASCADE;

DROP TABLE jobs;

COMMIT;
