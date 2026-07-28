-- Grounding proves the words are in the email; it says nothing about whether the number means
-- what the field name promises. "32" quoted from an email that says 32 m² was stored as 32 sq
-- ft — a tenfold error that only a second guard caught. The unit is now read from the email
-- like any other fact, with its own evidence, and a number with nothing beside it is a
-- question for a human rather than a default.

BEGIN;

ALTER TABLE messages ADD COLUMN IF NOT EXISTS area_unit text;

ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_area_status_known;
ALTER TABLE messages ADD CONSTRAINT messages_area_status_known
    CHECK (area_status IS NULL OR area_status IN (
        'known', 'converted', 'derived', 'contradicted', 'not_an_area', 'no_unit', 'unknown'));

ALTER TABLE messages ADD CONSTRAINT messages_area_unit_known
    CHECK (area_unit IS NULL OR area_unit IN ('sqft', 'sqm', 'sqyd'));

COMMENT ON COLUMN messages.area_unit IS
    'The unit the gate accepted for the area, read from the words the customer wrote and never assumed. Null means no unit was accepted — area_status says whether that was a number without one, a number that contradicted itself, or no number at all.';

COMMIT;
