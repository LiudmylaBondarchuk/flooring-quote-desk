BEGIN;

UPDATE messages SET auto_eligible = false WHERE auto_eligible AND area_status IS NULL;

ALTER TABLE messages VALIDATE CONSTRAINT messages_auto_needs_known_area;

ALTER TABLE service_area RENAME CONSTRAINT service_area_zone_check TO service_area_zone_known;

COMMIT;
