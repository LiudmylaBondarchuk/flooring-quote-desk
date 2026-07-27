BEGIN;

ALTER TABLE price_bands ALTER COLUMN min_charge DROP NOT NULL;
ALTER TABLE price_bands ADD CONSTRAINT price_bands_floor_has_minimum
    CHECK (component <> 'floor' OR min_charge IS NOT NULL);

ALTER TABLE offers DROP CONSTRAINT offers_total_sane;
ALTER TABLE offers ADD  CONSTRAINT offers_total_sane
    CHECK ((total_low IS NULL OR total_low >= 0) AND (total_high IS NULL OR total_high >= 0));

COMMENT ON COLUMN price_bands.min_charge IS
    'A minimum applies to a floor job. Stairs are charged per step and carry no minimum of their own.';

COMMIT;
