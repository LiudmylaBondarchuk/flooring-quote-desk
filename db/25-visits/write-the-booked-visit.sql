-- The booking, written against the job it belongs to.
--
-- Idempotent on the calendar event: Google's trigger can deliver the same booking twice, and a
-- second delivery must find it already recorded rather than open a second visit on one job.
--
-- The time is stored as the instant it is, not as the words the customer saw. What they saw
-- depended on their own browser; what the owner has to drive to does not.

INSERT INTO visits (order_id, state, offered, offered_in, agreed, agreed_at, booked_event_id)
SELECT $1::int, 'agreed', jsonb_build_array($2::timestamptz), NULL, $2::timestamptz, now(), $3::text
 WHERE $1::text <> ''
   AND NOT EXISTS (SELECT 1 FROM visits WHERE booked_event_id = $3::text)
RETURNING id, order_id, agreed, booked_event_id;
