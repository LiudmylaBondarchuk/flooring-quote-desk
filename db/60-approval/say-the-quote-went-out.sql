-- Written after the customer's copy has gone, never before. One statement, so an offer cannot read
-- as sent to somebody who was never written to.
--
-- Only an offer still waiting moves. A second reply in the same thread -- "thanks", "did that go?"
-- -- finds it already sent and changes nothing rather than sending the quote twice.

WITH moved AS (
  UPDATE offers
     SET status = 'sent'
   WHERE id = $2::int AND status = 'awaiting_approval'
  RETURNING id, order_id
),
noted AS (
  INSERT INTO order_events (order_id, gmail_message_id, kind, field, old_value, new_value)
  SELECT order_id, $1::text, 'state_change', 'offer_status', 'awaiting_approval', 'sent'
    FROM moved
  RETURNING 1
)
SELECT
  $2::int                                  AS offer_id,
  (SELECT count(*) FROM moved)::int = 1    AS now_sent,
  (SELECT count(*) FROM noted)::int = 1    AS change_recorded;
