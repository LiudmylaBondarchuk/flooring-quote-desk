-- The copy exists, and this is where. Guarded so a second run finds nothing to stamp rather than
-- pointing a visit at a second copy of itself.
--
-- And guarded on the time it was prepared for. Copying a document and filling it takes seconds, and
-- a customer can move the booking inside them: without this, the page printing the old date would be
-- filed against the moved visit, and agreement_url being set would then stop the right one ever
-- being prepared. If the visit moved while this was being made, nothing is stamped, the copy is left
-- on Drive under its own date, and the next run prepares the page the visit now needs.
--
-- To the millisecond, and on both sides, because that is the precision that survives the journey.
-- The time leaves this column with microseconds on it and reaches here having been through JSON,
-- which keeps thousandths: 12:13:55.395 was being compared against 12:13:55.395481 and never
-- matched. Nothing failed. agreement_url stayed null, the next run saw a visit with no page and
-- made another copy, and the run before it reported success -- ten copies of one agreement in
-- twenty minutes. Comparing what did not survive the trip is not a stricter guard, it is a guard
-- that is always false.
--
-- A millisecond is still far finer than the thing being guarded against. A visit is moved by a
-- person clicking a different slot on a booking page; two times a customer could pick are minutes
-- apart at the very least, and a rebooking that landed inside the same thousandth of a second
-- would be the same appointment.

UPDATE visits
   SET agreement_url = $2::text
 WHERE id = $1::int
   AND agreement_url IS NULL
   AND state = 'agreed'
   AND date_trunc('milliseconds', agreed) = date_trunc('milliseconds', $3::timestamptz)
RETURNING id, order_id, agreement_url;
