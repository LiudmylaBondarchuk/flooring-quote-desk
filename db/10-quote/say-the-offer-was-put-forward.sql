-- Written after the letter has gone, never before. One statement, so an offer cannot read as
-- waiting for somebody who was never written to, and the order's history cannot show a quote that
-- the offer does not know about.
--
-- Only a draft moves. A second run over the same offer -- a redelivered email, a retry -- finds it
-- already awaiting_approval and changes nothing, rather than telling the owner twice about the
-- same figure.

WITH moved AS (
  UPDATE offers
     SET status = 'awaiting_approval'
   WHERE id = $2::int AND status = 'draft'
  RETURNING id, order_id
),
noted AS (
  INSERT INTO order_events (order_id, gmail_message_id, kind, field, old_value, new_value)
  SELECT order_id, $1::text, 'state_change', 'offer_status', 'draft', 'awaiting_approval'
    FROM moved
  RETURNING 1
)
SELECT
  $2::int                                  AS offer_id,
  (SELECT count(*) FROM moved)::int = 1    AS now_waiting,
  (SELECT count(*) FROM noted)::int = 1    AS change_recorded;
