-- The invitation went out, so this job is waiting on a booking rather than on us.
--
-- A visit with no time yet: 'offered' is what it means to have asked and not been answered, and it
-- is what stops a second invitation going out on the next delivery of the same acceptance. There is
-- nothing in `offered` to store, because the times are Google's to know -- the array is there
-- because the table was built for the other design, where the desk named three itself.

INSERT INTO visits (order_id, state, offered, offered_in)
SELECT $2::int, 'offered', '["the booking page"]'::jsonb, $1::text
 WHERE NOT EXISTS (SELECT 1 FROM visits WHERE order_id = $2::int AND state IN ('offered', 'agreed'))
RETURNING id, order_id, state;
