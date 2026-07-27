BEGIN;

ALTER TABLE messages ALTER COLUMN gate_color DROP NOT NULL;
ALTER TABLE messages ALTER COLUMN gate_color DROP DEFAULT;

UPDATE messages SET gate_color = NULL
 WHERE gate_color = 'yellow' AND category IN ('pre_sales', 'operations', 'ignore_auto', 'owner_reply');

COMMIT;
