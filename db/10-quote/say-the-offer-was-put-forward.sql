-- Written after the draft exists in the owner's mailbox, never before. One statement, so an offer cannot
-- read as waiting on a draft that was never made, and the order's history cannot show a quote that
-- the offer does not know about.
--
-- Only a draft moves. A second run over the same offer -- a redelivered email, a retry -- finds it
-- already awaiting_approval and changes nothing, rather than putting a second copy of the same
-- figure in the owner's drafts.

WITH moved AS (
  UPDATE offers
     SET status = 'awaiting_approval',
         -- the customer's own conversation, which is where the draft was put and where the letter
         -- will appear when it is sent. It used to be the thread the owner was asked in, back when
         -- the desk mailed a copy and read the reply; there is no such thread now, because there is
         -- no such reply -- the sending is the answer.
         approval_thread_id = $3::text,
         -- the letter as it was drafted. What actually reaches the customer is whatever the owner sends,
         -- which may not be this: a draft can be edited, and that is the point of a draft. This is
         -- overwritten with what was really sent once it comes back through the mailbox.
         letter_text = $4::text
   WHERE id = $2::int AND status = 'draft'
  RETURNING id, order_id
),
noted AS (
  INSERT INTO order_events (order_id, gmail_message_id, kind, field, old_value, new_value)
  SELECT order_id, $1::text, 'state_change', 'offer_status', 'draft', 'awaiting_approval'
    FROM moved
  RETURNING 1
)
SELECT
  $2::int                                  AS offer_id,
  $3::text                                 AS approval_thread_id,
  (SELECT count(*) FROM moved)::int = 1    AS now_waiting,
  (SELECT count(*) FROM noted)::int = 1    AS change_recorded;
