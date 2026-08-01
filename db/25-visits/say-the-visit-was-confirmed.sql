-- The letter went out, so this booking is answered.
--
-- Guarded on confirmed_at rather than stamped blindly: two runs overlapping, or one retried after a
-- send that had already happened, must not put a second letter in front of a customer.

UPDATE visits
   SET confirmed_at = now()
 WHERE id = $1::int
   AND confirmed_at IS NULL
RETURNING id, order_id, confirmed_at;
