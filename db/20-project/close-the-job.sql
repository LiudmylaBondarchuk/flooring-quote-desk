-- The moment a job is won, in one statement: the offer accepted, the order booked, and both
-- changes recorded with the letter that caused them.
--
-- Written BEFORE the customer is told, which reverses the order used everywhere else here. The
-- costs are not symmetrical. A question that never arrived must not read as asked, so that one is
-- recorded after the send. But a customer who has seen a confirmation and a desk that has
-- forgotten the job is a job lost, while a desk that remembers and failed to write is a letter
-- somebody can send by hand. So this goes first.
--
-- Only an offer the customer has, and only a job still open. A second reply in the thread finds
-- the offer already accepted and changes nothing.

WITH before AS (
  SELECT id, state FROM orders WHERE id = $2::int FOR UPDATE
),
taken AS (
  UPDATE offers
     SET status = 'accepted', outcome = 'won'
   WHERE id = $3::int AND status = 'sent'
  RETURNING id, order_id, total_low, total_high
),
booked AS (
  UPDATE orders o
     -- both stamps, because they answer different questions and the database insists on the
     -- second: confirmed_at is when the customer agreed, closed_at is when the order stopped
     -- being one of the open ones. For a booking they happen to be the same moment.
     SET state = 'booked', confirmed_at = now(), closed_at = now(), updated_at = now()
   WHERE o.id = (SELECT order_id FROM taken)
     AND (SELECT state FROM before) NOT IN ('booked', 'done', 'lost')
  RETURNING o.id
),
noted_offer AS (
  INSERT INTO order_events (order_id, gmail_message_id, kind, field, old_value, new_value)
  SELECT order_id, $1::text, 'approved', 'offer_status', 'sent', 'accepted' FROM taken
  RETURNING 1
),
noted_state AS (
  INSERT INTO order_events (order_id, gmail_message_id, kind, field, old_value, new_value)
  SELECT id, $1::text, 'state_change', 'state', (SELECT state FROM before), 'booked' FROM booked
  RETURNING 1
)
SELECT
  $3::int                                       AS offer_id,
  $2::int                                       AS order_id,
  (SELECT state FROM before)                    AS was,
  (SELECT count(*) FROM taken)::int = 1         AS offer_accepted,
  (SELECT count(*) FROM booked)::int = 1        AS job_booked,
  (SELECT count(*) FROM noted_offer)::int = 1   AS acceptance_recorded,
  (SELECT count(*) FROM noted_state)::int = 1   AS state_recorded,
  (SELECT total_low FROM taken)                 AS total_low,
  (SELECT total_high FROM taken)                AS total_high;
