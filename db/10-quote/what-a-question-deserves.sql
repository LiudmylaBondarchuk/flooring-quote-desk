-- Whether this email asked something the firm can answer, and the words to answer it with.
--
-- The answer is read from services rather than from the message, so editing what the firm says
-- about tile is one edit in one table. The message only remembers which row it was asking about.
--
-- Only when there is nothing else to do with the email. An enquiry that names a floor, a size and a
-- town happens to mention laminate too, and it deserves a price, not a leaflet.

WITH asked AS (
  SELECT m.gmail_message_id, m.contact_email, m.thread_id, m.category,
         m.service_asked_about, m.order_id,
         coalesce(m.auto_blocked, false) AS auto_blocked
    FROM messages m
   WHERE m.gmail_message_id = $1::text
),
what_we_said AS (
  SELECT s.label, s.we_do, s.answer
    FROM services s
   WHERE lower(s.label) = lower((SELECT service_asked_about FROM asked))
),
next_words AS (
  SELECT body FROM reply_templates WHERE key = 'after_a_service_answer'
),
signature AS (
  SELECT body FROM reply_templates WHERE key = 'signature'
)
SELECT
  a.gmail_message_id,
  a.contact_email,
  a.thread_id,
  a.service_asked_about,
  w.we_do,
  w.answer,
  (SELECT body FROM next_words)                       AS what_next,
  (SELECT body FROM signature)                        AS signature,
  a.auto_blocked,
  a.service_asked_about IS NOT NULL
    AND w.answer IS NOT NULL
    AND a.contact_email IS NOT NULL
    AND NOT a.auto_blocked                            AS worth_answering
  FROM asked a
  LEFT JOIN what_we_said w ON true;
