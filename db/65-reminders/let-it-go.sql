-- An order nobody has answered for long enough stops being open. Nothing is sent: letting go is a
-- decision about the desk's own books, not a message to a customer, and a letter saying "we assume
-- you are not interested" is the kind that arrives the day somebody finally replies.
--
-- The change is recorded with what it moved from, so a quote that went cold and one that was never
-- answered at all read differently afterwards.

WITH before AS (
  SELECT id, state FROM orders WHERE id = $1::int FOR UPDATE
),
moved AS (
  UPDATE orders o
     SET state = 'lost', closed_at = now(), updated_at = now()
   WHERE o.id = (SELECT id FROM before)
     AND (SELECT state FROM before) NOT IN ('booked', 'done', 'lost')
  RETURNING o.id
),
noted AS (
  INSERT INTO order_events (order_id, gmail_message_id, kind, field, old_value, new_value)
  SELECT id, NULL, 'state_change', 'state', (SELECT state FROM before), 'lost' FROM moved
  RETURNING 1
)
SELECT
  $1::int                                 AS order_id,
  (SELECT state FROM before)              AS was,
  (SELECT count(*) FROM moved)::int = 1   AS let_go,
  (SELECT count(*) FROM noted)::int = 1   AS change_recorded;
