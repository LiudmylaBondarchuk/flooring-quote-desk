-- A computed price that is not written down is a price nobody can be held to. This is where it
-- becomes a record: the range, the parts it is made of, and the version of the arithmetic that
-- produced it, so a quote given today can still be explained after the price list has moved.
--
-- One statement, so an offer cannot exist without the order having moved, and the order cannot
-- read as quoted with no offer behind it.
--
-- The order's previous state is read before it changes and written into the event, because
-- "quoted" is only half the story — a first quote and a re-quote after the customer changed the
-- room are different things, and the difference is what it was before.
--
-- Nothing here closes anything. The offer is a draft: it exists, it has not been sent, and no
-- part of this decides whether it should be.

WITH before AS (
  SELECT id, state FROM orders WHERE id = $2::int FOR UPDATE
),
made AS (
  INSERT INTO offers (order_id, subtotal_low, subtotal_high, total_low, total_high,
                      breakdown, pricing_version, status)
  SELECT b.id, $3::numeric, $4::numeric, $5::numeric, $6::numeric, $7::jsonb, $8::text, 'draft'
    FROM before b
   WHERE b.state NOT IN ('booked', 'done', 'lost')
  RETURNING id, order_id
),
moved AS (
  UPDATE orders o SET state = 'quoted', updated_at = now()
   WHERE o.id = (SELECT order_id FROM made)
     AND (SELECT state FROM before) IS DISTINCT FROM 'quoted'
  RETURNING o.id
),
noted AS (
  INSERT INTO order_events (order_id, gmail_message_id, kind, field, old_value, new_value)
  SELECT id, $1, 'state_change', 'state', (SELECT state FROM before), 'quoted' FROM moved
  RETURNING 1
),
linked AS (
  UPDATE messages SET offer_id = (SELECT id FROM made)
   WHERE gmail_message_id = $1 AND (SELECT count(*) FROM made) = 1
  RETURNING 1
)
SELECT
  $1::text                                     AS gmail_message_id,
  (SELECT id FROM made)                        AS offer_id,
  (SELECT order_id FROM made)                  AS order_id,
  (SELECT state FROM before)                   AS state_before,
  (SELECT count(*) FROM moved)::int = 1        AS order_moved,
  (SELECT count(*) FROM noted)::int = 1        AS change_recorded,
  (SELECT count(*) FROM linked)::int = 1       AS message_linked;
