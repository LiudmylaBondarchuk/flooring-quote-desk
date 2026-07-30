-- The gate works out which of the firm's services an email is asking about, and has always thrown
-- the answer away. So "do you install laminate?" is understood, categorised, routed -- and nobody
-- ever replies to it. The desk understands the question and says nothing.
--
-- One column, holding the label, not the answer. The answer lives in services and can be edited
-- there; copying it onto the message would make a second place for it to be wrong, and the first
-- thing a second copy does is disagree.
--
-- NULL means the email was not asking about a service, which is most of them.

BEGIN;

ALTER TABLE messages ADD COLUMN service_asked_about text;

COMMENT ON COLUMN messages.service_asked_about IS
    'Which row of services this email was asking about, by label. The answer itself stays in that table so there is one place to edit what the firm says.';

COMMIT;
