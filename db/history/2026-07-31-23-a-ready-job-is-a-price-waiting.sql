-- Everything the gate knew about history it counted from messages. The lookup that feeds it
-- mentions the messages table five times and the orders table not once, so every rule asking
-- "does this email carry a material and a size" was really asking "did they repeat themselves in
-- the last letter".
--
-- A customer who wrote "laminate, Kyle TX" on Monday, "about 400 sq ft" on Tuesday and "can you
-- send me the price?" on Wednesday was filed as continuing a conversation and handed to a lane
-- that does nothing. The job had everything a price needs. Nobody priced it. That was the third
-- defect of the same shape found by a real letter in two days, and the shape is always the same:
-- a rule reading the letter where it should read the job.
--
-- The lookup now hands the gate the open order for the thread, and one rule is added ahead of
-- everything that files a letter as "carry on where we left off": a job with a material, a size
-- and a town, which nobody has quoted, is a price waiting to be worked out -- whatever this
-- particular letter happens to say.

BEGIN;

ALTER TABLE messages DROP CONSTRAINT messages_matched_rule_known;
ALTER TABLE messages ADD CONSTRAINT messages_matched_rule_known
    CHECK (matched_rule IS NULL OR matched_rule IN (
        'owner_sent', 'automated_headers', 'fraud_unknown_sender', 'nothing_readable',
        'complaint_signal', 'offer_response', 'money_known_contact', 'scheduling_signal',
        'the_job_is_ready', 'same_job_signature', 'thread_continuation', 'not_a_customer',
        'capability_question', 'wants_a_price', 'unclassified'));

COMMIT;
