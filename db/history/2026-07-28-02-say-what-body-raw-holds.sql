BEGIN;

COMMENT ON COLUMN messages.body_raw IS
    'The text the email carried: its plain part, or the plain text recovered from its HTML. body holds the same text with the quoted history removed, body_html the markup it came in.';

COMMIT;
