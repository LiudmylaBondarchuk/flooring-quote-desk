-- Written after the question has gone out, never before. If sending fails, nothing here runs and
-- the next email asks again — which is the right way round: a question the customer never received
-- must not count as asked.

INSERT INTO order_events (order_id, gmail_message_id, kind, field, old_value, new_value)
SELECT $2::int, $1::text, 'asked', 'still_missing', NULL, $3::text
 WHERE $2::int IS NOT NULL
RETURNING order_id, new_value AS asked_for;
