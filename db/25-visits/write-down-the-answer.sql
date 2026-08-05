-- What a person said about a booking made from a town the price was not worked out for.
--
-- A no calls the visit off and closes the job in the same statement as recording the answer,
-- because an answer written without the acting on it leaves a booking marked as decided and a
-- visit still standing in the calendar -- the worst of both, and silent.
--
-- A yes only writes the yes down. What happens next is the ordinary confirmation, which the letter
-- step picks up on its own now that nothing is holding it.

-- The answer and what it does to the visit are one update, not two. Postgres carries out a single
-- modification per row per statement and drops the rest without a word, so writing the answer and
-- then calling the visit off left a booking marked as answered and still standing in the calendar.
WITH answered AS (
  UPDATE visits
     SET site_agreed = $2::boolean,
         state       = CASE WHEN $2::boolean THEN state ELSE 'lapsed' END
   WHERE id = $1::int
     AND site_agreed IS NULL
  RETURNING id, order_id, site_agreed, state
),
called_off AS (
  SELECT id FROM answered WHERE site_agreed = false
),
closed AS (
  UPDATE orders
     SET state = 'lost', closed_at = now(), updated_at = now()
   WHERE id = (SELECT order_id FROM answered WHERE site_agreed = false)
     AND state NOT IN ('booked', 'done', 'lost')
  RETURNING id
),
stamped AS (
  INSERT INTO order_events (order_id, gmail_message_id, kind, field, old_value, new_value)
  SELECT id, NULL, 'state_change', 'state', $3::text, 'lost' FROM closed
  RETURNING 1
)
SELECT $1::int                                  AS visit_id,
       (SELECT count(*) FROM answered)::int = 1 AS answer_recorded,
       (SELECT count(*) FROM called_off)::int = 1 AS visit_called_off,
       (SELECT count(*) FROM closed)::int = 1     AS job_closed;
