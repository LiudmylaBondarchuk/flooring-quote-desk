WITH open_in_thread AS (
  SELECT id FROM orders
   WHERE thread_id = $2
     AND state NOT IN ('booked', 'done', 'lost')
   ORDER BY created_at DESC
   LIMIT 1
),
made AS (
  INSERT INTO orders (contact_email, thread_id)
  SELECT $3, $2
   WHERE NOT EXISTS (SELECT 1 FROM open_in_thread)
     AND $4::boolean
  RETURNING id
),
born AS (
  INSERT INTO order_events (order_id, gmail_message_id, kind)
  SELECT id, $1, 'created' FROM made
  RETURNING 1
)
SELECT
  $1::text                                        AS gmail_message_id,
  coalesce((SELECT id FROM open_in_thread),
           (SELECT id FROM made))                 AS order_id,
  (SELECT count(*) FROM born)::int = 1            AS order_was_created,
  (SELECT count(*) FROM open_in_thread)::int = 1  AS order_was_found;
