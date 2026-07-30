-- Which offer, if any, this letter is an answer to.
--
-- Everything the desk sends to itself arrives back as an owner_reply, including the letters it
-- sent, so most of what reaches this lane is answering nothing. The only thing that ties an answer
-- to an offer is the thread the letter went out in, and only an offer still waiting can be
-- answered -- one already sent has been decided.
--
-- The customer's address and the message to reply to come from the order rather than from the
-- offer, because a reply belongs in the customer's own thread and the last thing they wrote is
-- what Gmail continues.

WITH waiting AS (
  SELECT o.id, o.order_id, o.letter_text, o.total_low, o.total_high
    FROM offers o
   WHERE o.status = 'awaiting_approval'
     AND o.approval_thread_id = $2::text
   ORDER BY o.created_at DESC
   LIMIT 1
),
her_words AS (
  -- the body with quoted history already stripped by the router. The letter she is replying to
  -- carries the whole quote underneath it, so reading the raw message would find the desk's own
  -- words and take them for her answer.
  SELECT body FROM messages WHERE gmail_message_id = $1::text
),
their_last_word AS (
  SELECT m.gmail_message_id, m.contact_email, m.thread_id
    FROM messages m
   WHERE m.order_id = (SELECT order_id FROM waiting)
     AND m.is_outbound = false
   ORDER BY m.created_at DESC
   LIMIT 1
)
SELECT
  $1::text                                        AS gmail_message_id,
  h.body                                          AS said,
  w.id                                            AS offer_id,
  w.order_id,
  w.letter_text,
  w.total_low, w.total_high,
  t.gmail_message_id                              AS reply_to,
  t.contact_email,
  t.thread_id                                     AS customer_thread_id,
  w.id IS NOT NULL
    AND w.letter_text IS NOT NULL
    AND t.gmail_message_id IS NOT NULL            AS an_offer_is_waiting
  FROM (SELECT 1) AS always
  LEFT JOIN her_words        h ON true
  LEFT JOIN waiting          w ON true
  LEFT JOIN their_last_word  t ON true;
