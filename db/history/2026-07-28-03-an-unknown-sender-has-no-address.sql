BEGIN;

ALTER TABLE messages ALTER COLUMN contact_email DROP NOT NULL;
ALTER TABLE messages ALTER COLUMN contact_email DROP DEFAULT;

UPDATE messages SET contact_email = NULL WHERE contact_email = '';

COMMENT ON COLUMN messages.contact_email IS
    'Null when the sender is unknown — a platform lead with no reply-to. Null never matches null, so an unknown sender cannot inherit anyone else''s history.';

COMMIT;
