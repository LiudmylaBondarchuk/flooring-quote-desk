BEGIN;

CREATE TABLE contacts (
    id          integer     GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    email       text        NOT NULL,
    name        text,
    phone       text,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX contacts_email_unique ON contacts (lower(email));

CREATE TABLE jobs (
    id          integer     GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    contact_id  integer     REFERENCES contacts (id) ON DELETE CASCADE,
    address     text,
    zip         text,
    signature   text,
    status      text        NOT NULL DEFAULT 'new',
    created_at  timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT jobs_status_known CHECK (status IN (
        'new', 'needs_info', 'quoted', 'negotiating',
        'booked', 'done', 'lost', 'survey_needed'))
);

CREATE UNIQUE INDEX jobs_contact_signature_unique ON jobs (contact_id, signature);

CREATE TABLE offers (
    id              integer     GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    job_id          integer     REFERENCES jobs (id) ON DELETE CASCADE,
    subtotal_low    numeric(10, 2),
    subtotal_high   numeric(10, 2),
    total_low       numeric(10, 2),
    total_high      numeric(10, 2),
    breakdown       jsonb,
    doc_url         text,
    pricing_version text,
    status          text        NOT NULL DEFAULT 'draft',
    outcome         text,
    final_amount    numeric(10, 2),
    created_at      timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT offers_status_known  CHECK (status IN ('draft', 'sent', 'accepted', 'declined', 'expired')),
    CONSTRAINT offers_outcome_known CHECK (outcome IS NULL OR outcome IN ('won', 'lost')),
    CONSTRAINT offers_total_sane    CHECK ((total_low  IS NULL OR total_low  >= 0)
                                        AND (total_high IS NULL OR total_high >= 0)),
    CONSTRAINT offers_total_ordered CHECK (total_high IS NULL OR total_low IS NULL OR total_high >= total_low)
);

CREATE TABLE messages (
    id                        integer     GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    contact_id                integer     REFERENCES contacts (id) ON DELETE SET NULL,
    job_id                    integer     REFERENCES jobs (id)     ON DELETE SET NULL,
    offer_id                  integer     REFERENCES offers (id)   ON DELETE SET NULL,

    gmail_message_id          text        NOT NULL UNIQUE,
    internet_message_id       text,
    thread_id                 text        NOT NULL,
    direction                 text        NOT NULL,
    sender                    text        NOT NULL,
    source                    text        NOT NULL DEFAULT 'gmail_direct',
    contact_email             text        NOT NULL DEFAULT '',
    from_name                 text        NOT NULL DEFAULT '',
    is_outbound               boolean     NOT NULL DEFAULT false,
    needs_sender_extraction   boolean     NOT NULL DEFAULT false,
    auto_submitted            text,
    precedence                text,
    list_unsubscribe          boolean     NOT NULL DEFAULT false,
    contract_version          integer     NOT NULL DEFAULT 1,
    raw_email                 jsonb       NOT NULL DEFAULT '{}'::jsonb,

    body_raw                  text        NOT NULL DEFAULT '',
    body_html                 text        NOT NULL DEFAULT '',
    body                      text        NOT NULL DEFAULT '',
    body_empty                boolean     NOT NULL DEFAULT false,
    body_fully_quoted         boolean     NOT NULL DEFAULT false,
    has_photo                 boolean     NOT NULL DEFAULT false,
    image_count               integer     NOT NULL DEFAULT 0,
    pdf_count                 integer     NOT NULL DEFAULT 0,

    extracted                 jsonb,
    intent                    text,
    prompt_version            text,
    extraction_schema_version text,

    category                  text        NOT NULL DEFAULT 'unknown',
    route                     text        NOT NULL DEFAULT 'review',
    handling                  text        NOT NULL DEFAULT 'manual_review',
    gate_color                text,
    gate_reasons              jsonb       NOT NULL DEFAULT '[]'::jsonb,
    missing_fields            jsonb       NOT NULL DEFAULT '[]'::jsonb,
    dropped_fields            jsonb       NOT NULL DEFAULT '[]'::jsonb,
    assumptions               jsonb       NOT NULL DEFAULT '[]'::jsonb,
    segment                   text,
    geo_zone                  text,
    danger                    boolean     NOT NULL DEFAULT false,
    pricing_allowed             boolean     NOT NULL DEFAULT false,
    is_returning              boolean     NOT NULL DEFAULT false,
    same_signature            boolean     NOT NULL DEFAULT false,
    material_category         text,
    area_sqft                 numeric(10, 2),
    area_status               text,
    existing_floor_action     text,
    old_floor_removal         boolean,
    fixing_method             text,
    workflow_version          text,

    status                    text        NOT NULL DEFAULT 'new',
    handled_by                text,
    handoff_at                timestamptz,
    created_at                timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT messages_direction_known CHECK (direction IN ('inbound', 'outbound')),
    CONSTRAINT messages_sender_known    CHECK (sender    IN ('client', 'owner')),
    CONSTRAINT messages_source_known    CHECK (source    IN ('gmail_direct', 'owner_sent', 'platform')),

    CONSTRAINT messages_category_known CHECK (category IN (
        'quote_request', 'pre_sales', 'existing_project', 'scheduling', 'offer_response',
        'billing', 'complaint', 'operations', 'ignore_auto', 'owner_reply', 'unknown')),
    CONSTRAINT messages_route_known    CHECK (route IN (
        'quote', 'project', 'support', 'operations', 'review', 'log')),
    CONSTRAINT messages_handling_known CHECK (handling IN ('auto', 'manual_review', 'none')),
    CONSTRAINT messages_color_known    CHECK (gate_color IS NULL OR gate_color IN ('green', 'yellow', 'red')),
    CONSTRAINT messages_segment_known  CHECK (segment  IS NULL OR segment  IN ('residential', 'commercial')),
    CONSTRAINT messages_zone_known     CHECK (geo_zone IS NULL OR geo_zone IN ('core', 'edge', 'out')),
    CONSTRAINT messages_status_known   CHECK (status IN (
        'new', 'triaged', 'closed', 'awaiting_pricing', 'awaiting_owner',
        'awaiting_manual_review', 'digest_pending')),

    CONSTRAINT messages_material_known CHECK (material_category IS NULL
        OR material_category IN ('LVP', 'Laminate', 'Wood', 'Vinyl', 'Carpet')),
    CONSTRAINT messages_area_status_known CHECK (area_status IS NULL OR area_status IN (
        'known', 'converted', 'derived', 'contradicted', 'not_an_area', 'unknown')),
    CONSTRAINT messages_floor_action_known CHECK (existing_floor_action IS NULL
        OR existing_floor_action IN ('remove_first', 'over_existing')),
    CONSTRAINT messages_fixing_known CHECK (fixing_method IS NULL OR fixing_method IN (
        'click_lock', 'floating', 'glue_down', 'nail_down', 'staple_down',
        'loose_lay', 'peel_and_stick', 'mortar_set', 'thinset')),

    CONSTRAINT messages_pricing_is_green_quote CHECK (pricing_allowed = false
        OR (category = 'quote_request' AND gate_color = 'green')),
    CONSTRAINT messages_pricing_never_dangerous CHECK (pricing_allowed = false OR danger = false),
    CONSTRAINT messages_pricing_needs_known_area CHECK (pricing_allowed = false OR area_status = 'known'),
    CONSTRAINT messages_auto_reply_is_safe CHECK (handling <> 'auto'
        OR (danger = false AND category IN ('pre_sales', 'quote_request'))),
    CONSTRAINT messages_handoff_is_stamped CHECK ((handled_by IS NULL) = (handoff_at IS NULL))
);

CREATE INDEX messages_thread_idx    ON messages (thread_id);
CREATE INDEX messages_contact_idx   ON messages (lower(contact_email), created_at DESC);
CREATE INDEX messages_open_work_idx ON messages (route, created_at DESC) WHERE handled_by IS NULL;
CREATE INDEX messages_signature_idx ON messages (lower(contact_email), material_category, area_sqft)
    WHERE material_category IS NOT NULL AND area_sqft IS NOT NULL;

CREATE TABLE service_area (
    id     integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    city   text    NOT NULL,
    zip    text,
    zone   text    NOT NULL,
    notes  text,

    CONSTRAINT service_area_zone_known CHECK (zone IN ('core', 'edge', 'out'))
);

CREATE UNIQUE INDEX service_area_city_zip_unique ON service_area (lower(city), coalesce(zip, ''));
CREATE INDEX service_area_zip_idx ON service_area (zip) WHERE zip IS NOT NULL;

CREATE TABLE price_bands (
    id           integer        GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    category     text           NOT NULL,
    component    text           NOT NULL DEFAULT 'floor',
    product      text,
    unit         text           NOT NULL DEFAULT 'sqft',
    rate_low     numeric(10, 2) NOT NULL,
    rate_high    numeric(10, 2) NOT NULL,
    wastage_pct  integer        NOT NULL DEFAULT 10,
    min_charge   numeric(10, 2),
    notes        text,

    CONSTRAINT price_bands_component_known CHECK (component IN ('floor', 'stairs', 'trim')),
    CONSTRAINT price_bands_floor_has_minimum CHECK (component <> 'floor' OR min_charge IS NOT NULL),
    CONSTRAINT price_bands_unit_known  CHECK (unit IN ('sqft', 'sqyd', 'each', 'job')),
    CONSTRAINT price_bands_range_sane  CHECK (rate_low > 0 AND rate_high >= rate_low),
    CONSTRAINT price_bands_wastage_pct CHECK (wastage_pct BETWEEN 0 AND 100)
);

CREATE UNIQUE INDEX price_bands_product_unique ON price_bands (category, component, coalesce(product, ''));

CREATE TABLE pricing_rules (
    id        integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    rule_key  text    NOT NULL UNIQUE,
    val_low   numeric(10, 2),
    val_high  numeric(10, 2),
    notes     text,

    CONSTRAINT pricing_rules_range_sane CHECK (val_high IS NULL OR val_low IS NULL OR val_high >= val_low)
);

CREATE TABLE services (
    id           integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    priority     integer NOT NULL DEFAULT 100,
    label        text    NOT NULL,
    we_do        boolean NOT NULL,
    match_words  text    NOT NULL,
    answer       text    NOT NULL,
    notes        text
);

CREATE UNIQUE INDEX services_label_unique ON services (lower(label));

CREATE TABLE failures (
    id                integer     GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    source            text        NOT NULL,
    workflow_name     text,
    workflow_id       text,
    execution_id      text,
    node_name         text,
    message           text        NOT NULL,
    gmail_message_id  text,
    payload           jsonb,
    notified          boolean     NOT NULL DEFAULT false,
    resolved_at       timestamptz,
    created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX failures_open_idx ON failures (created_at DESC) WHERE resolved_at IS NULL;

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
COMMENT ON COLUMN services.priority IS
    'Lower wins when an email matches more than one entry. "vinyl tile" is plank work, not tile work.';
COMMENT ON COLUMN offers.total_low IS
    'A quote for this work is a range, not a number. final_amount holds what was actually agreed.';
COMMENT ON COLUMN price_bands.min_charge IS
    'A minimum applies to a floor job. Stairs are charged per step and carry no minimum of their own.';
COMMENT ON COLUMN price_bands.component IS
    'Floors are priced per square foot, stairs per step. The component decides which unit applies.';
COMMENT ON COLUMN messages.pricing_allowed IS
    'Nothing blocks putting a price in front of this customer. Says nothing about who sends it.';
COMMENT ON COLUMN messages.handling IS
    'Who answers: auto means a reply may leave without a human, manual_review means it may not, none means no reply at all.';
COMMENT ON COLUMN messages.same_signature IS
    'This contact already asked about the same material and area recently.';

COMMIT;
