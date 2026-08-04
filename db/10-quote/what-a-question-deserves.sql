-- Whether this email asked something the firm can answer, and the words to answer it with.
--
-- The answer is read from services rather than from the message, so editing what the firm says
-- about tile is one edit in one table. The message only remembers which row it was asking about.
--
-- Only when there is nothing else to do with the email. An enquiry that names a floor, a size and a
-- town happens to mention laminate too, and it deserves a price, not a leaflet.

WITH asked AS (
  SELECT m.gmail_message_id, m.contact_email, m.thread_id, m.category,
         m.service_asked_about, m.order_id, m.material_category,
         coalesce(m.auto_blocked, false) AS auto_blocked
    FROM messages m
   WHERE m.gmail_message_id = $1::text
),
what_we_said AS (
  SELECT s.label, s.we_do, s.answer
    FROM services s
   WHERE lower(s.label) = lower((SELECT service_asked_about FROM asked))
),
first_words AS (
  -- Every other letter this desk sends acknowledges the person before it says anything. This one
  -- went straight to "Yes, we install laminate", which reads as brisk to somebody who has just
  -- written in -- and it is the letter most likely to be the first thing anybody sees from the firm.
  SELECT body FROM reply_templates WHERE key = 'service_answer_opening'
),
next_words AS (
  SELECT body FROM reply_templates WHERE key = 'after_a_service_answer'
),
signature AS (
  SELECT body FROM reply_templates WHERE key = 'signature'
),
-- What the work costs per square foot, so the first answer somebody gets carries a figure.
--
-- The question this branch answers is "do you do this at all", and until now the reply said yes
-- and then asked for the size and the town. That is the pause this desk exists to remove: the one
-- thing anybody wants to know first is what it costs, and the rates are published -- a range from
-- the price list is not a quote, it commits nobody, and it can be said before anything else is
-- known. The other branch of this same lane has said it all along; this one had not.
--
-- Narrowed to the material the gate recognised in the letter, and to everything the firm lays when
-- it recognised none. Somebody who asked about laminate is shown laminate rather than a wall of
-- every floor in the book.
--
-- Only floors. Stairs are charged per step and levelling per square foot of trouble, and neither
-- can be honestly quoted to somebody who has not been measured -- they are named at the visit.
rates AS (
  SELECT json_agg(json_build_object('product', b.product,
                                    'rate_low', b.rate_low,
                                    'rate_high', b.rate_high) ORDER BY b.rate_low, b.id) AS bands
    FROM price_bands b
   WHERE b.active
     AND b.component = 'floor'
     AND (b.category = (SELECT material_category FROM asked)
          OR (SELECT material_category FROM asked) IS NULL)
)
SELECT
  a.gmail_message_id,
  a.contact_email,
  a.thread_id,
  a.service_asked_about,
  w.we_do,
  w.answer,
  (SELECT body FROM first_words)                      AS opening,
  (SELECT body FROM next_words)                       AS what_next,
  (SELECT body FROM signature)                        AS signature,
  (SELECT bands FROM rates)                           AS bands,
  (SELECT body FROM reply_templates WHERE key = 'rates_preamble') AS rates_preamble,
  a.auto_blocked,
  a.service_asked_about IS NOT NULL
    AND w.answer IS NOT NULL
    AND a.contact_email IS NOT NULL
    AND NOT a.auto_blocked                            AS worth_answering
  FROM asked a
  LEFT JOIN what_we_said w ON true;
