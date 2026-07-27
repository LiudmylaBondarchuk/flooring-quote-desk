BEGIN;

UPDATE messages SET gate_color = 'yellow' WHERE handling = 'manual_review' AND gate_color IS NULL;

ALTER TABLE messages ALTER COLUMN gate_color SET DEFAULT 'yellow';

ALTER TABLE messages ADD CONSTRAINT messages_queued_work_has_a_colour
    CHECK (handling <> 'manual_review' OR gate_color IS NOT NULL);

COMMIT;
