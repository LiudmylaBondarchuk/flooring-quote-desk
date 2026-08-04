-- Written after the customer's copy has gone, never before -- and now it has genuinely gone before
-- this runs, because the owner sent it herself. This records what happened; it cannot cause it.
--
-- Only an offer still waiting moves. A second letter in the same thread finds it already sent and
-- changes nothing.
--
-- Three things are recorded, and they answer three different questions.
--
-- WHAT THE CUSTOMER READ. The sent letter is tied to the offer by offer_id, so what actually
-- reached them is one join away and is the letter itself rather than a copy of it. letter_text is
-- left as it was drafted: the two are different facts and overwriting one with the other destroys
-- the only evidence that they ever differed.
--
-- WHETHER SHE REWROTE IT. An event, kind 'approved' or 'rejected' -- two kinds this schema has
-- always allowed and nothing has ever written. Counting them answers "how often does the owner
-- overrule the arithmetic", which is a question about whether the desk is any good, and there is
-- nowhere else it could be counted from.
--
-- Compared with the whitespace squeezed out of both sides, and that is not a detail. What comes
-- back has been through the reader that strips quoted history and collapses runs of spaces, so an
-- untouched letter returns with its indentation flattened and compares unequal to the one that was
-- drafted. Comparing them raw called every single letter a rewrite. The letters differ in their
-- spacing every time and in their words only when she changed them; this compares the words.

WITH the_letter AS (
  SELECT m.gmail_message_id, m.order_id, m.body
    FROM messages m
   WHERE m.gmail_message_id = $1::text
),
proposed AS (
  SELECT o.id, o.letter_text
    FROM offers o
   WHERE o.id = $2::int
),
moved AS (
  UPDATE offers
     SET status = 'sent'
   WHERE id = $2::int AND status = 'awaiting_approval'
  RETURNING id, order_id
),
tied AS (
  -- what the customer read, findable from the offer rather than guessed at later
  UPDATE messages
     SET offer_id = $2::int
   WHERE gmail_message_id = $1::text
     AND EXISTS (SELECT 1 FROM moved)
  RETURNING 1
),
noted AS (
  INSERT INTO order_events (order_id, gmail_message_id, kind, field, old_value, new_value)
  SELECT order_id, $1::text, 'state_change', 'offer_status', 'awaiting_approval', 'sent'
    FROM moved
  RETURNING 1
),
judged AS (
  INSERT INTO order_events (order_id, gmail_message_id, kind, field, old_value, new_value)
  SELECT m.order_id, $1::text,
         CASE WHEN regexp_replace(btrim(coalesce(l.body, '')), '\s+', ' ', 'g')
                 = regexp_replace(btrim(coalesce(p.letter_text, '')), '\s+', ' ', 'g')
              THEN 'approved' ELSE 'rejected' END,
         'letter_text',
         'the wording the desk proposed',
         CASE WHEN regexp_replace(btrim(coalesce(l.body, '')), '\s+', ' ', 'g')
                 = regexp_replace(btrim(coalesce(p.letter_text, '')), '\s+', ' ', 'g')
              THEN 'sent as it was drafted' ELSE 'rewritten before it was sent' END
    FROM moved m
    JOIN the_letter l ON true
    JOIN proposed   p ON true
  RETURNING kind
)
SELECT
  $2::int                                  AS offer_id,
  (SELECT count(*) FROM moved)::int = 1    AS now_sent,
  (SELECT count(*) FROM noted)::int = 1    AS change_recorded,
  (SELECT count(*) FROM tied)::int = 1     AS letter_tied_to_offer,
  (SELECT kind FROM judged)                AS she_said;
