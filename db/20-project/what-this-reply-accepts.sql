-- What a reply to a quote is answering, and which way it went.
--
-- Which way is the gate's verdict, read here rather than worked out again: one place decides, and
-- a second copy of the vocabulary would drift from the first.
--
-- The offer has to be one the customer actually has. An offer still waiting for the owner has not
-- reached them, and nothing they wrote can be an answer to it.

WITH this_message AS (
  SELECT gmail_message_id, thread_id, contact_email, offer_answer, order_id,
         coalesce(auto_blocked, false) AS auto_blocked
    FROM messages
   WHERE gmail_message_id = $1::text
),
the_job AS (
  SELECT o.id, o.state, o.material_category, o.area_sqft, o.city
    FROM orders o
   WHERE o.thread_id = (SELECT thread_id FROM this_message)
     AND o.state NOT IN ('booked', 'done', 'lost')
   ORDER BY o.created_at DESC
   LIMIT 1
),
the_offer AS (
  SELECT f.id, f.total_low, f.total_high, f.status
    FROM offers f
   WHERE f.order_id = (SELECT id FROM the_job)
     AND f.status = 'sent'
   ORDER BY f.created_at DESC
   LIMIT 1
)
SELECT
  m.gmail_message_id,
  m.contact_email,
  m.offer_answer,
  m.auto_blocked,
  j.id                                     AS order_id,
  j.material_category, j.area_sqft, j.city,
  f.id                                     AS offer_id,
  f.total_low, f.total_high,
  (SELECT body FROM reply_templates WHERE key = 'booked_confirmation') AS confirmation,
  (SELECT body FROM reply_templates WHERE key = 'signature')           AS signature,
  f.id IS NOT NULL AND m.offer_answer = 'accepted'                     AS accepted,
  f.id IS NOT NULL AND m.offer_answer = 'pushed_back'                  AS pushed_back
  FROM this_message m
  LEFT JOIN the_job   j ON true
  LEFT JOIN the_offer f ON true;
