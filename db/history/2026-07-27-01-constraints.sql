-- Applied once, on 2026-07-27, against the Neon instance as it stood that day:
-- a schema grown by hand through the build, with legacy category and route values
-- and no constraints. It is not reproducible from an empty database and is kept
-- only as the record of how that instance was brought up to db/schema.sql.
-- A fresh install runs db/schema.sql and nothing else.

BEGIN;

UPDATE messages SET category = 'quote_request' WHERE category = 'quote';
UPDATE messages SET category = 'ignore_auto'   WHERE category = 'not_lead';
UPDATE messages SET route    = 'support'       WHERE route    = 'complaint';
UPDATE messages SET route    = 'log'           WHERE route    = 'ignore';
UPDATE messages SET status   = 'closed'        WHERE status   = 'ignored';

UPDATE messages SET
    category                = coalesce(category, 'unknown'),
    route                   = coalesce(route, 'review'),
    handling                = coalesce(handling, 'manual_review'),
    gate_color              = coalesce(gate_color, 'yellow'),
    gate_reasons            = coalesce(gate_reasons, '[]'::jsonb),
    missing_fields          = coalesce(missing_fields, '[]'::jsonb),
    dropped_fields          = coalesce(dropped_fields, '[]'::jsonb),
    assumptions             = coalesce(assumptions, '[]'::jsonb),
    source                  = coalesce(source, 'gmail_direct'),
    contact_email           = coalesce(contact_email, ''),
    from_name               = coalesce(from_name, ''),
    raw_email               = coalesce(raw_email, '{}'::jsonb),
    body_raw                = coalesce(body_raw, ''),
    body_html               = coalesce(body_html, ''),
    body                    = coalesce(body, ''),
    body_empty              = coalesce(body_empty, false),
    body_fully_quoted       = coalesce(body_fully_quoted, false),
    has_photo               = coalesce(has_photo, false),
    image_count             = coalesce(image_count, 0),
    pdf_count               = coalesce(pdf_count, 0),
    is_outbound             = coalesce(is_outbound, false),
    needs_sender_extraction = coalesce(needs_sender_extraction, false),
    list_unsubscribe        = coalesce(list_unsubscribe, false),
    contract_version        = coalesce(contract_version, 1),
    danger                  = coalesce(danger, false),
    auto_eligible           = coalesce(auto_eligible, false),
    is_returning            = coalesce(is_returning, false),
    same_signature          = coalesce(same_signature, false),
    status                  = coalesce(status, 'new');

ALTER TABLE messages
    ALTER COLUMN thread_id              SET NOT NULL,
    ALTER COLUMN direction              SET NOT NULL,
    ALTER COLUMN sender                 SET NOT NULL,
    ALTER COLUMN source                 SET NOT NULL, ALTER COLUMN source           SET DEFAULT 'gmail_direct',
    ALTER COLUMN contact_email          SET NOT NULL, ALTER COLUMN contact_email    SET DEFAULT '',
    ALTER COLUMN from_name              SET NOT NULL, ALTER COLUMN from_name        SET DEFAULT '',
    ALTER COLUMN is_outbound            SET NOT NULL, ALTER COLUMN is_outbound      SET DEFAULT false,
    ALTER COLUMN needs_sender_extraction SET NOT NULL, ALTER COLUMN needs_sender_extraction SET DEFAULT false,
    ALTER COLUMN list_unsubscribe       SET NOT NULL, ALTER COLUMN list_unsubscribe SET DEFAULT false,
    ALTER COLUMN contract_version       SET NOT NULL, ALTER COLUMN contract_version SET DEFAULT 1,
    ALTER COLUMN raw_email              SET NOT NULL, ALTER COLUMN raw_email        SET DEFAULT '{}'::jsonb,
    ALTER COLUMN body_raw               SET NOT NULL, ALTER COLUMN body_raw         SET DEFAULT '',
    ALTER COLUMN body_html              SET NOT NULL, ALTER COLUMN body_html        SET DEFAULT '',
    ALTER COLUMN body                   SET NOT NULL, ALTER COLUMN body             SET DEFAULT '',
    ALTER COLUMN body_empty             SET NOT NULL, ALTER COLUMN body_empty       SET DEFAULT false,
    ALTER COLUMN body_fully_quoted      SET NOT NULL, ALTER COLUMN body_fully_quoted SET DEFAULT false,
    ALTER COLUMN has_photo              SET NOT NULL, ALTER COLUMN has_photo        SET DEFAULT false,
    ALTER COLUMN image_count            SET NOT NULL, ALTER COLUMN image_count      SET DEFAULT 0,
    ALTER COLUMN pdf_count              SET NOT NULL, ALTER COLUMN pdf_count        SET DEFAULT 0,
    ALTER COLUMN category               SET NOT NULL, ALTER COLUMN category         SET DEFAULT 'unknown',
    ALTER COLUMN route                  SET NOT NULL, ALTER COLUMN route            SET DEFAULT 'review',
    ALTER COLUMN handling               SET NOT NULL, ALTER COLUMN handling         SET DEFAULT 'manual_review',
    ALTER COLUMN gate_color             SET NOT NULL, ALTER COLUMN gate_color       SET DEFAULT 'yellow',
    ALTER COLUMN gate_reasons           SET NOT NULL, ALTER COLUMN gate_reasons     SET DEFAULT '[]'::jsonb,
    ALTER COLUMN missing_fields         SET NOT NULL, ALTER COLUMN missing_fields   SET DEFAULT '[]'::jsonb,
    ALTER COLUMN dropped_fields         SET NOT NULL, ALTER COLUMN dropped_fields   SET DEFAULT '[]'::jsonb,
    ALTER COLUMN assumptions            SET NOT NULL, ALTER COLUMN assumptions      SET DEFAULT '[]'::jsonb,
    ALTER COLUMN danger                 SET NOT NULL, ALTER COLUMN danger           SET DEFAULT false,
    ALTER COLUMN auto_eligible          SET NOT NULL, ALTER COLUMN auto_eligible    SET DEFAULT false,
    ALTER COLUMN is_returning           SET NOT NULL, ALTER COLUMN is_returning     SET DEFAULT false,
    ALTER COLUMN same_signature         SET NOT NULL, ALTER COLUMN same_signature   SET DEFAULT false,
    ALTER COLUMN status                 SET NOT NULL, ALTER COLUMN status           SET DEFAULT 'new',
    ALTER COLUMN created_at             SET NOT NULL,
    ALTER COLUMN area_sqft              TYPE numeric(10, 2);

ALTER TABLE messages
    ADD CONSTRAINT messages_direction_known CHECK (direction IN ('inbound', 'outbound')),
    ADD CONSTRAINT messages_sender_known    CHECK (sender    IN ('client', 'owner')),
    ADD CONSTRAINT messages_source_known    CHECK (source    IN ('gmail_direct', 'owner_sent', 'platform')),
    ADD CONSTRAINT messages_category_known CHECK (category IN (
        'quote_request', 'pre_sales', 'existing_project', 'scheduling', 'offer_response',
        'billing', 'complaint', 'operations', 'ignore_auto', 'owner_reply', 'unknown')),
    ADD CONSTRAINT messages_route_known    CHECK (route IN (
        'quote', 'project', 'support', 'operations', 'review', 'log')),
    ADD CONSTRAINT messages_handling_known CHECK (handling IN ('auto', 'manual_review', 'none')),
    ADD CONSTRAINT messages_color_known    CHECK (gate_color IN ('green', 'yellow', 'red')),
    ADD CONSTRAINT messages_segment_known  CHECK (segment  IS NULL OR segment  IN ('residential', 'commercial')),
    ADD CONSTRAINT messages_zone_known     CHECK (geo_zone IS NULL OR geo_zone IN ('core', 'edge', 'out')),
    ADD CONSTRAINT messages_status_known   CHECK (status IN (
        'new', 'triaged', 'closed', 'awaiting_pricing', 'awaiting_owner',
        'awaiting_manual_review', 'digest_pending')),
    ADD CONSTRAINT messages_material_known CHECK (material_category IS NULL
        OR material_category IN ('LVP', 'Laminate', 'Wood', 'Vinyl', 'Carpet')),
    ADD CONSTRAINT messages_area_status_known CHECK (area_status IS NULL OR area_status IN (
        'known', 'converted', 'derived', 'contradicted', 'not_an_area', 'unknown')),
    ADD CONSTRAINT messages_floor_action_known CHECK (existing_floor_action IS NULL
        OR existing_floor_action IN ('remove_first', 'over_existing')),
    ADD CONSTRAINT messages_fixing_known CHECK (fixing_method IS NULL OR fixing_method IN (
        'click_lock', 'floating', 'glue_down', 'nail_down', 'staple_down',
        'loose_lay', 'peel_and_stick', 'mortar_set', 'thinset')),
    ADD CONSTRAINT messages_area_sane CHECK (area_sqft IS NULL OR (area_sqft > 0 AND area_sqft <= 20000)),
    ADD CONSTRAINT messages_auto_is_green_quote CHECK (auto_eligible = false
        OR (category = 'quote_request' AND gate_color = 'green')),
    ADD CONSTRAINT messages_auto_never_dangerous CHECK (auto_eligible = false OR danger = false),
    ADD CONSTRAINT messages_handoff_is_stamped CHECK ((handled_by IS NULL) = (handoff_at IS NULL));

ALTER TABLE messages
    ADD CONSTRAINT messages_auto_needs_known_area CHECK (auto_eligible = false OR area_status = 'known')
    NOT VALID;

ALTER TABLE messages
    ADD CONSTRAINT messages_offer_id_fkey FOREIGN KEY (offer_id) REFERENCES offers (id) ON DELETE SET NULL;

ALTER TABLE jobs
    ALTER COLUMN status     SET NOT NULL,
    ALTER COLUMN created_at SET NOT NULL,
    ADD CONSTRAINT jobs_status_known CHECK (status IN (
        'new', 'needs_info', 'quoted', 'negotiating',
        'booked', 'done', 'lost', 'survey_needed'));

ALTER TABLE offers
    ALTER COLUMN status     SET NOT NULL,
    ALTER COLUMN created_at SET NOT NULL,
    ALTER COLUMN subtotal     TYPE numeric(10, 2),
    ALTER COLUMN total        TYPE numeric(10, 2),
    ALTER COLUMN final_amount TYPE numeric(10, 2),
    ADD CONSTRAINT offers_status_known  CHECK (status IN ('draft', 'sent', 'accepted', 'declined', 'expired')),
    ADD CONSTRAINT offers_outcome_known CHECK (outcome IS NULL OR outcome IN ('won', 'lost')),
    ADD CONSTRAINT offers_total_sane    CHECK (total IS NULL OR total >= 0);

ALTER TABLE contacts ALTER COLUMN created_at SET NOT NULL;

ALTER TABLE price_bands
    ALTER COLUMN category    SET NOT NULL,
    ALTER COLUMN unit        SET NOT NULL,
    ALTER COLUMN rate_low    SET NOT NULL,
    ALTER COLUMN rate_high   SET NOT NULL,
    ALTER COLUMN wastage_pct SET NOT NULL,
    ALTER COLUMN rate_low    TYPE numeric(10, 2),
    ALTER COLUMN rate_high   TYPE numeric(10, 2),
    ALTER COLUMN min_charge  TYPE numeric(10, 2),
    ADD CONSTRAINT price_bands_unit_known  CHECK (unit IN ('sqft', 'sqyd', 'each', 'job')),
    ADD CONSTRAINT price_bands_range_sane  CHECK (rate_low > 0 AND rate_high >= rate_low),
    ADD CONSTRAINT price_bands_wastage_pct CHECK (wastage_pct BETWEEN 0 AND 100);

ALTER TABLE pricing_rules
    ALTER COLUMN rule_key SET NOT NULL,
    ALTER COLUMN val_low  TYPE numeric(10, 2),
    ALTER COLUMN val_high TYPE numeric(10, 2),
    ADD CONSTRAINT pricing_rules_key_unique UNIQUE (rule_key),
    ADD CONSTRAINT pricing_rules_range_sane CHECK (val_high IS NULL OR val_low IS NULL OR val_high >= val_low);

ALTER TABLE failures
    ALTER COLUMN notified   SET NOT NULL,
    ALTER COLUMN notified   SET DEFAULT false,
    ALTER COLUMN created_at SET NOT NULL;

DROP INDEX IF EXISTS idx_contacts_email;
DROP INDEX IF EXISTS idx_messages_contact;
DROP INDEX IF EXISTS idx_messages_thread;
DROP INDEX IF EXISTS idx_service_area_city;
DROP INDEX IF EXISTS idx_service_area_zip;
DROP INDEX IF EXISTS idx_failures_open;
ALTER INDEX IF EXISTS uq_jobs_signature RENAME TO jobs_contact_signature_unique;

CREATE UNIQUE INDEX contacts_email_unique      ON contacts (lower(email));
CREATE INDEX        messages_thread_idx        ON messages (thread_id);
CREATE INDEX        messages_contact_idx       ON messages (lower(contact_email), created_at DESC);
CREATE INDEX        messages_open_work_idx     ON messages (route, created_at DESC) WHERE handled_by IS NULL;
CREATE INDEX        messages_signature_idx     ON messages (lower(contact_email), material_category, area_sqft)
    WHERE material_category IS NOT NULL AND area_sqft IS NOT NULL;
CREATE UNIQUE INDEX service_area_city_zip_unique ON service_area (lower(city), coalesce(zip, ''));
CREATE INDEX        service_area_zip_idx         ON service_area (zip) WHERE zip IS NOT NULL;
CREATE UNIQUE INDEX price_bands_product_unique   ON price_bands (category, coalesce(product, ''));
CREATE INDEX        failures_open_idx            ON failures (created_at DESC) WHERE resolved_at IS NULL;

DO $$
DECLARE t text; next_id bigint;
BEGIN
    FOREACH t IN ARRAY ARRAY['contacts', 'jobs', 'messages', 'offers', 'price_bands',
                             'pricing_rules', 'service_area', 'services', 'failures']
    LOOP
        EXECUTE format('SELECT coalesce(max(id), 0) + 1 FROM %I', t) INTO next_id;
        EXECUTE format('ALTER TABLE %I ALTER COLUMN id DROP DEFAULT', t);
        EXECUTE format('DROP SEQUENCE IF EXISTS %I', t || '_id_seq');
        EXECUTE format('ALTER TABLE %I ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (RESTART WITH %s)', t, next_id);
    END LOOP;
END $$;

COMMENT ON COLUMN messages.extracted IS
    'What the model claimed. Never constrained, never trusted on its own.';
COMMENT ON COLUMN messages.intent IS
    'The model''s guess at intent. An input to classification, never the classification itself.';
COMMENT ON COLUMN messages.category IS
    'What the gate decided after checking every model value against the words in the email.';
COMMENT ON COLUMN messages.dropped_fields IS
    'Values the model produced that no words in the email supported.';
COMMENT ON COLUMN messages.body_raw IS
    'The email as it arrived. body holds the same text with the quoted history removed.';
COMMENT ON COLUMN messages.area_sqft IS
    'Square feet the gate accepted. area_status says how it got there: stated, converted or derived.';
COMMENT ON COLUMN messages.same_signature IS
    'This contact already asked about the same material and area recently.';

COMMIT;
