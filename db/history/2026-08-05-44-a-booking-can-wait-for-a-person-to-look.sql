-- Where a visit is held while somebody looks at it, and what they said.
--
-- Only bookings whose town disagrees with the town the price was worked out for. Everything else
-- confirms itself as it always did: a booking made at two in the morning must not sit unanswered
-- until somebody wakes up, and a desk that holds every booking for a person is a desk with a person
-- in front of it all night.
--
-- Three columns rather than one, because "nobody has been asked", "asked and waiting" and "answered
-- no" are three different states and a single boolean can only tell two of them apart. asked_at is
-- what makes the middle one visible: a booking waiting on an answer that never comes is a booking
-- somebody has to be able to find.
--
-- The channel is kept beside the timestamp because Slack needs both to say what a message was
-- reacted to with, and the channel a line went to is a thing that changes.

ALTER TABLE visits
  ADD COLUMN IF NOT EXISTS site_check_ts      text,
  ADD COLUMN IF NOT EXISTS site_check_channel text,
  ADD COLUMN IF NOT EXISTS site_check_asked_at timestamptz,
  ADD COLUMN IF NOT EXISTS site_agreed        boolean;

COMMENT ON COLUMN visits.site_agreed IS
  'Null while nobody has answered. True when a person confirmed the booked address is the job''s. False when they said it is not, which calls the visit off.';
