-- Where the agreement for a visit was put, so it is prepared once and can be found again.
--
-- Null means no copy yet, which is also what makes preparing one idempotent: the lane asks for
-- visits that have none, so a second run finds nothing to do rather than filling the owner's Drive
-- with copies of one job.
--
-- The template itself is a row rather than a constant, for the same reason the booking page is: the
-- owner rewrites that document, and rewriting it must not need a deploy.

ALTER TABLE visits ADD COLUMN IF NOT EXISTS agreement_url text;

COMMENT ON COLUMN visits.agreement_url IS
    'Where this visit''s copy of the agreement was put on Drive. Null until one exists, which is what stops a second being made. Never emailed to the customer: it is signed on paper, on site.';

INSERT INTO reply_templates (key, body, sends_automatically, notes) VALUES
    ('agreement_template',
     '1e8Gi_w92GIcE1oXJk4QGGBRGIk3lMoNJZY8tZiOoquE',
     false,
     'the Google Doc the agreement is copied from, by file id. Never sent anywhere: the lane copies this document and fills the copy. Rewriting the agreement means editing that document; moving it means changing this row and nothing else.')
ON CONFLICT (key) DO UPDATE SET body = excluded.body, notes = excluded.notes, updated_at = now();
