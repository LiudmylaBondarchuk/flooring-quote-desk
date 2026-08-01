-- The booking is gone from the calendar, so the visit is not happening.
--
-- The job stays where it is. A cancelled visit does not close a job or reopen a quote: somebody
-- still wants a floor, and what happens next is a conversation, not a state change made by a
-- polling loop that noticed an empty slot.
--
-- Nothing is written to anybody. When the owner cancels, the reason is hers and a cheerful
-- "pick another time" from the desk lands exactly wrong; when the customer cancels, Google has
-- already said so. Both were decided rather than defaulted.

UPDATE visits
   SET state = 'lapsed'
 WHERE id = $1::int
   AND state = 'agreed'
RETURNING id, order_id, state;
