-- Which line was posted about this booking, so the answer to it can be found later.
--
-- The channel as well as the timestamp: Slack needs both to say what a message has been reacted to
-- with, and which channel a line goes to is a thing that changes.
--
-- Only the first asking sticks. A lane that runs again over the same booking must not move the
-- question to a newer message and leave an answer sitting on the old one, unread for ever.

UPDATE visits
   SET site_check_ts       = $2::text,
       site_check_channel  = $3::text,
       site_check_asked_at = now()
 WHERE id = $1::int
   AND site_check_ts IS NULL
RETURNING id AS visit_id, order_id, site_check_ts, site_check_asked_at;
