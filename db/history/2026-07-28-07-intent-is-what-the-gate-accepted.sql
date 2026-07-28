-- Run this only after the Decision gate carrying INTENT_WHITELIST is live and a real
-- message has been seen writing null rather than ''. In the other order, the window
-- between the constraint and the deploy is made of refused writes, and a refused write
-- leaves the email with its untriaged defaults and tells nobody.
--
-- The UPDATE reports how many rows it cleared. That number belongs in the commit message:
-- it is the first measurement of how often the model returned an intent nobody listed.

BEGIN;

UPDATE messages SET intent = NULL
 WHERE intent IS NOT NULL
   AND intent NOT IN ('new_quote', 'pre_sales_question', 'follow_up', 'offer_response',
                      'scheduling', 'billing', 'complaint', 'spam_or_other');

ALTER TABLE messages ADD CONSTRAINT messages_intent_known
    CHECK (intent IS NULL OR intent IN (
        'new_quote', 'pre_sales_question', 'follow_up', 'offer_response',
        'scheduling', 'billing', 'complaint', 'spam_or_other'));

COMMENT ON COLUMN messages.intent IS
    'What the gate accepted of the model''s guess at intent, null when the answer was not on the list. An input to classification, never the classification itself; the raw answer stays in extracted.';

COMMIT;
