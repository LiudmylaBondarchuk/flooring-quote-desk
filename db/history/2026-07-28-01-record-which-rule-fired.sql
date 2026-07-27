BEGIN;

ALTER TABLE messages ADD COLUMN matched_rule text;
ALTER TABLE messages ADD COLUMN out_of_scope text;

COMMENT ON COLUMN messages.matched_rule IS
    'Which of the classification rules fired. The only record of why this email went where it went.';

COMMENT ON COLUMN services.priority IS
    'Order within one side of the catalogue. What the firm does is always checked before what it refuses, in code.';

COMMIT;
