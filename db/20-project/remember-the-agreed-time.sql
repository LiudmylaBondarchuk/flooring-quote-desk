-- The time the customer picked, written down against the offer it answers.
--
-- Idempotent on the message: the router can deliver the same reply twice, and the second delivery
-- must find the visit already agreed and change nothing. Guarded on state rather than on agreed_in
-- so that a second, different reply to a settled visit is also refused -- a customer who changes
-- their mind is a person's conversation, not a silent overwrite of a date somebody has driven to.

WITH answered AS (
  -- nullif before the cast: a reply on a job with no open offer arrives here with no visit at all,
  -- and "" is not an integer. The lane runs this for every reply rather than branching first, so
  -- the statement is what has to hold when there is nothing to settle.
  SELECT $1::text                        AS gmail_message_id,
         nullif($2::text, '')::int       AS visit_id,
         nullif($3::text, '')::timestamptz AS agreed
),
settled AS (
  UPDATE visits v
     SET state = 'agreed', agreed = a.agreed, agreed_in = a.gmail_message_id, agreed_at = now()
    FROM answered a
   WHERE v.id = a.visit_id
     AND v.state = 'offered'
     -- a reply nobody could read arrives here too, with no time on it. Refusing it in the statement
     -- rather than upstream keeps the lane one path: without this the write is attempted, the
     -- constraint refuses an agreed visit with no time, and a customer's ordinary "none of those
     -- work" turns into an entry in the error lane.
     AND a.agreed IS NOT NULL
  RETURNING v.id, v.order_id, v.agreed
)
SELECT (SELECT gmail_message_id FROM answered)  AS gmail_message_id,
       (SELECT id FROM settled)                 AS visit_id,
       (SELECT order_id FROM settled)           AS order_id,
       (SELECT agreed FROM settled)             AS agreed,
       EXISTS (SELECT 1 FROM settled)           AS was_settled;
