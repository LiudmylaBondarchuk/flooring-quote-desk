-- The price list lives in a spreadsheet the owner already knows how to open, and this database
-- is what the spreadsheet is copied into. Two consequences had to be built before that copy can
-- be allowed to run unattended.
--
-- First, a row that disappears from the sheet must not disappear from here. A deleted row is the
-- one edit a person makes by accident, and prices that were quoted against it still have to be
-- explainable months later. So the copy never deletes: what is absent goes inactive, and every
-- reader that speaks for the firm asks for active rows only.
--
-- Second, category was the one column in this table nothing constrained, while
-- lookup-geo-catalogue-history reads SELECT DISTINCT category FROM price_bands and hands the
-- result to the gate as the list of things the firm installs. A typo in a spreadsheet was one
-- sync away from teaching the gate a sixth material. The whitelist here is the same five the
-- gate and value-lists.json already name.
--
-- price_band_events is the reason a sync can be trusted at all: after it runs, what changed is
-- a query rather than a memory.

BEGIN;

ALTER TABLE price_bands
    ADD COLUMN active     boolean     NOT NULL DEFAULT true,
    ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE price_bands
    ADD CONSTRAINT price_bands_category_known
    CHECK (category IN ('LVP', 'Laminate', 'Wood', 'Vinyl', 'Carpet'));

CREATE INDEX price_bands_active_idx ON price_bands (category) WHERE active;

CREATE TABLE price_band_events (
    id            integer     GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    price_band_id integer     REFERENCES price_bands (id) ON DELETE SET NULL,
    band_key      text        NOT NULL,
    kind          text        NOT NULL,
    field         text,
    old_value     text,
    new_value     text,
    created_at    timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT price_band_events_kind_known CHECK (kind IN (
        'added', 'changed', 'deactivated', 'reactivated'))
);

CREATE INDEX price_band_events_band_idx ON price_band_events (price_band_id, created_at);
CREATE INDEX price_band_events_when_idx ON price_band_events (created_at DESC);

COMMENT ON COLUMN price_bands.active IS
    'False means the row left the spreadsheet. Nothing quotes it; everything already quoted against it still reads.';
COMMENT ON TABLE price_band_events IS
    'One row per field a sync changed. Answers "why is this price different from last month" without a backup.';

COMMIT;
