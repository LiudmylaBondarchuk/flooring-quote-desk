-- A message already records what the gate reported about it. It does not record what the gate
-- was prepared to stand behind, and those are not the same thing: an area of 200000 sq ft is
-- reported so a person can see the number the customer wrote, and settled behind nothing.
--
-- That difference only started to matter now. A question like "do you install laminate?" opens no
-- order — it is not work yet — so the Laminate the gate recognised has nowhere to go, and the next
-- email in the thread starts from nothing. The fix is for a new order to begin with what the
-- thread has already said, which means reading facts off messages that predate it.
--
-- Reading the reported columns would reintroduce exactly what was just closed: the implausible
-- area is in messages.area_sqft. Deriving the verdict again in SQL would put the plausible range
-- in a second place, and the first thing a second copy does is disagree.
--
-- So the message keeps the verdict it was given, in the same shape the gate emits and the merge
-- consumes. Older rows have none, and a NULL here reads as "nothing was settled", which is the
-- safe answer for a message decided before this column existed.

BEGIN;

ALTER TABLE messages ADD COLUMN settled jsonb;

COMMENT ON COLUMN messages.settled IS
    'The facts the gate stood behind for this message, as it handed them to the merge. Distinct from the reported columns beside it, which show what the customer wrote even where it was refused.';

COMMIT;
