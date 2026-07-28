BEGIN;

ALTER TABLE messages RENAME COLUMN auto_eligible TO pricing_allowed;

ALTER TABLE messages RENAME CONSTRAINT messages_auto_eligible_not_null TO messages_pricing_allowed_not_null;
ALTER TABLE messages RENAME CONSTRAINT messages_auto_is_green_quote   TO messages_pricing_is_green_quote;
ALTER TABLE messages RENAME CONSTRAINT messages_auto_never_dangerous  TO messages_pricing_never_dangerous;
ALTER TABLE messages RENAME CONSTRAINT messages_auto_needs_known_area TO messages_pricing_needs_known_area;

ALTER TABLE messages DROP CONSTRAINT messages_color_known;
ALTER TABLE messages ADD  CONSTRAINT messages_color_known
    CHECK (gate_color IS NULL OR gate_color IN ('green', 'yellow', 'red'));

ALTER TABLE messages ADD CONSTRAINT messages_auto_reply_is_safe CHECK (handling <> 'auto'
    OR (danger = false AND category IN ('pre_sales', 'quote_request')));

ALTER TABLE price_bands ADD COLUMN component text NOT NULL DEFAULT 'floor';
ALTER TABLE price_bands ADD CONSTRAINT price_bands_component_known
    CHECK (component IN ('floor', 'stairs', 'trim'));
ALTER TABLE price_bands ALTER COLUMN min_charge SET NOT NULL;
DROP INDEX price_bands_product_unique;
CREATE UNIQUE INDEX price_bands_product_unique
    ON price_bands (category, component, coalesce(product, ''));

DELETE FROM pricing_rules WHERE rule_key = 'min_charge_default';

ALTER TABLE offers DROP CONSTRAINT offers_total_sane;
ALTER TABLE offers RENAME COLUMN subtotal TO subtotal_low;
ALTER TABLE offers RENAME COLUMN total    TO total_low;
ALTER TABLE offers ADD COLUMN subtotal_high numeric(10, 2);
ALTER TABLE offers ADD COLUMN total_high    numeric(10, 2);
ALTER TABLE offers ADD CONSTRAINT offers_total_sane    CHECK (total_low IS NULL OR total_low >= 0);
ALTER TABLE offers ADD CONSTRAINT offers_total_ordered CHECK (total_high IS NULL OR total_low IS NULL OR total_high >= total_low);

COMMENT ON COLUMN messages.pricing_allowed IS
    'Nothing blocks putting a price in front of this customer. Says nothing about who sends it.';
COMMENT ON COLUMN messages.handling IS
    'Who answers: auto means a reply may leave without a human, manual_review means it may not, none means no reply at all.';
COMMENT ON COLUMN offers.total_low IS
    'A quote for this work is a range, not a number. final_amount holds what was actually agreed.';
COMMENT ON COLUMN price_bands.component IS
    'Floors are priced per square foot, stairs per step. The component decides which unit applies.';

COMMIT;
