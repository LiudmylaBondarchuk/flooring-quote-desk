-- A customer who says yes to a price worked out from an email has not booked work. They have agreed
-- to a visit, because nobody has seen the floor and the number came from what they typed.
--
-- This is the boundary the earlier attempt got wrong: it moved the order straight to 'booked' from
-- an email, which promises a date this desk cannot honour and a price it cannot stand behind. What
-- an acceptance moves is 'quoted' -> 'survey_needed'. Only a firm offer -- one given after somebody
-- has stood in the room -- may book, and nothing issues one yet.
--
-- Written to be run twice without harm: an order already past 'quoted' is left where it is, and an
-- offer already settled keeps its outcome. The router can redeliver, and a second delivery must not
-- reopen a job somebody has since finished.

WITH answered AS (
  SELECT m.order_id, m.offer_answer
    FROM messages m
   WHERE m.gmail_message_id = $1::text
     AND m.offer_answer = 'accepted'
     AND m.order_id IS NOT NULL
),
the_offer AS (
  SELECT o.id, o.kind
    FROM offers o
    JOIN answered a ON a.order_id = o.order_id
   WHERE o.status IN ('sent', 'awaiting_approval', 'accepted')
   ORDER BY o.created_at DESC
   LIMIT 1
),
settled AS (
  UPDATE offers o SET status = 'accepted', outcome = 'won'
    FROM the_offer t
   WHERE o.id = t.id
     AND o.outcome IS NULL
  RETURNING o.id
),
moved AS (
  UPDATE orders o
     SET state = CASE WHEN t.kind = 'firm' THEN 'booked' ELSE 'survey_needed' END,
         -- the database refuses a closed order with no closing time, and booked is a closed state.
         -- survey_needed is not: the job is still open, it is waiting for somebody to see it.
         closed_at = CASE WHEN t.kind = 'firm' THEN now() ELSE o.closed_at END
    FROM answered a, the_offer t
   WHERE o.id = a.order_id
     AND o.state IN ('quoted', 'negotiating')
  RETURNING o.id, o.state
)
SELECT (SELECT order_id FROM answered)                     AS order_id,
       (SELECT kind FROM the_offer)                        AS offer_kind,
       (SELECT id FROM settled)                            AS offer_settled,
       (SELECT state FROM moved)                           AS order_state,
       EXISTS (SELECT 1 FROM moved)                        AS moved;
