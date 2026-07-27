BEGIN;

ALTER TABLE services ADD COLUMN priority integer NOT NULL DEFAULT 100;
UPDATE services SET priority = id * 10;

COMMENT ON COLUMN services.priority IS
    'Lower wins when an email matches more than one entry. "vinyl tile" is plank work, not tile work.';

COMMIT;
