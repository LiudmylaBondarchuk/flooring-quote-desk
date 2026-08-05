-- Written after the owner has been told, and on the second telling it closes the job.
--
-- The closing is here rather than in a step of its own because the two must not come apart: a
-- telling recorded without the closing would leave the job open with its two tellings spent, waiting
-- for a third that never comes. The state it is moving from is passed in rather than read here --
-- read here it would be read after this statement's own update, and the history would record the
-- job moving from lost to lost.

WITH said AS (
  INSERT INTO order_events (order_id, gmail_message_id, kind, field, old_value, new_value)
  VALUES ($2::int, NULL, 'asked', 'the_owner', NULL, $1::text)
  RETURNING order_id
),
closed AS (
  UPDATE orders SET state = 'lost', closed_at = now()
   WHERE id = $2::int AND $3::boolean
  RETURNING id
),
expired AS (
  UPDATE offers SET status = 'expired'
   WHERE id = $1::int AND $3::boolean
  RETURNING id
),
stamped AS (
  INSERT INTO order_events (order_id, gmail_message_id, kind, field, old_value, new_value)
  SELECT id, NULL, 'state_change', 'state', $4::text, 'lost' FROM closed
  RETURNING 1
)
SELECT $1::int                            AS offer_id,
       (SELECT count(*) FROM said)::int = 1     AS telling_recorded,
       (SELECT count(*) FROM closed)::int = 1   AS job_closed,
       (SELECT count(*) FROM expired)::int = 1  AS offer_expired;
