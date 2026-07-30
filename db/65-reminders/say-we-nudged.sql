-- Written after the nudge has gone. One per order, ever: the statement refuses a second because
-- the order it belongs to already has one, and a customer who ignored the first will not be helped
-- by a third.

INSERT INTO order_events (order_id, gmail_message_id, kind, field, old_value, new_value)
SELECT $1::int, $2::text, 'asked', 'reminder', NULL, 'nudged after silence'
 WHERE NOT EXISTS (SELECT 1 FROM order_events e
                    WHERE e.order_id = $1::int AND e.kind = 'asked' AND e.field = 'reminder')
RETURNING order_id, new_value;
