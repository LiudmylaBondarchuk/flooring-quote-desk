-- Whether this outbound letter is the quote going out.
--
-- Everything the desk sends reaches the mailbox again as an owner_reply, so most of what arrives
-- here is the desk reading its own post. What is being looked for is narrower than it used to be:
-- not a word of assent somewhere in the letter, but one particular letter having left.
--
-- The old shape asked "did the owner say send it" and read the reply with a pattern. That is gone.
-- A quote now waits in the owner's drafts, in the customer's own conversation, and the owner sends it --
-- so the sending IS the answer, and there is nothing left to interpret. A pattern that had to
-- decide whether "ok" meant yes cannot be wrong about this any more, because it is no longer asked.
-- It also cannot refuse a quote because the owner wrote "let me change one word", which is what `change`
-- being a word of refusal used to do.
--
-- What identifies it: an offer waiting on this thread, and this letter going out in it. Between
-- drafting a quote and its sending the desk puts nothing else into that conversation -- the
-- branch that asks a customer for what is missing cannot fire for an order that is already quoted,
-- because nothing is missing from it. So the next letter out of that thread is the quote.
--
-- Being wrong here costs bookkeeping and never a customer: what reaches them is whatever the owner
-- pressed send on, and no row in this database can add to that or take it away.

WITH this_letter AS (
  SELECT m.gmail_message_id, m.thread_id, m.order_id, m.body, m.is_outbound
    FROM messages m
   WHERE m.gmail_message_id = $1::text
),
waiting AS (
  -- The offer this letter is carrying, identified by the letter carrying its figures.
  --
  -- Thread membership alone was not enough and was wrong in two ways at once. The owner writes in
  -- the customer's own conversation -- that is the whole point of leaving the draft there -- so an
  -- ordinary note of her own ("I will follow up tomorrow") is an outbound message in a thread with
  -- an offer waiting, and counted as the quote going out. The offer was then marked sent to
  -- somebody who never received it, which is worse than a wrong statistic: the reminder reads that
  -- status, so nothing would ever have chased the draft still lying unsent.
  --
  -- And with two offers waiting in one thread, the newest was taken whichever was sent.
  --
  -- The figures answer both. They are generated from this offer and printed as one line, so a note
  -- does not carry them and a rewritten quote still does -- removing the price is not an edit to a
  -- quote, it is not sending one. Formatted here exactly as the composer formats it, because it is
  -- that string being looked for and not a number.
  --
  -- Strict on purpose. Failing to recognise a quote leaves the offer waiting and the owner
  -- reminded, which is a nuisance; recognising the wrong letter tells a customer's job that a price
  -- reached them when it did not.
  --
  -- An expired one counts too. Being told twice and left unsent closes the job -- which is a guess
  -- about what the owner meant by saying nothing, and this letter is not a guess. Somebody sent the
  -- price. Whatever the desk concluded from the silence before it, it was wrong, and a job whose
  -- price reached the customer is not a lost job.
  SELECT o.id, o.order_id, o.total_low, o.total_high, o.letter_text
    FROM offers o
   WHERE o.status IN ('awaiting_approval', 'expired')
     AND o.approval_thread_id = $2::text
     AND o.total_low IS NOT NULL
     AND (SELECT body FROM this_letter) LIKE
         '%$' || to_char(round(o.total_low),  'FM999,999,999')
             || ' to $' || to_char(round(o.total_high), 'FM999,999,999') || '%'
   ORDER BY o.created_at DESC
   LIMIT 1
),
the_customer AS (
  SELECT m.contact_email
    FROM messages m
   WHERE m.order_id = (SELECT order_id FROM waiting)
     AND m.is_outbound = false
     AND m.contact_email IS NOT NULL
   ORDER BY m.created_at DESC
   LIMIT 1
)
SELECT
  $1::text                                        AS gmail_message_id,
  w.id                                            AS offer_id,
  w.order_id,
  w.total_low, w.total_high,
  t.contact_email,
  $2::text                                        AS customer_thread_id,
  -- What was actually sent is this message's own body, and it stays there rather than being copied
  -- onto the offer. Comparing the two to spot an edit was tried and cannot work: what comes back
  -- has been through the reader that strips quoted history and squeezes runs of spaces, so an
  -- untouched letter returns different from the one that was drafted.
  coalesce(w.id IS NOT NULL AND l.is_outbound, false)    AS the_quote_went_out
  FROM (SELECT 1) AS always
  LEFT JOIN this_letter  l ON true
  LEFT JOIN waiting      w ON true
  LEFT JOIN the_customer t ON true;
