BEGIN;

ALTER TABLE messages ADD CONSTRAINT messages_matched_rule_known
    CHECK (matched_rule IS NULL OR matched_rule IN (
        'owner_sent', 'automated_headers', 'fraud_unknown_sender', 'nothing_readable',
        'complaint_signal', 'offer_response', 'money_known_contact', 'scheduling_signal',
        'same_job_signature', 'thread_continuation', 'not_a_customer', 'capability_question',
        'wants_a_price', 'unclassified'));

COMMIT;
