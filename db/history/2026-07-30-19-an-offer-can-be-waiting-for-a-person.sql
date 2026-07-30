-- An offer has been a draft that nothing ever did anything with. Now it becomes a letter, and the
-- letter goes to the owner, so there is a state between "worked out" and "the customer has it":
-- somebody has been asked to look at this and has not answered yet.
--
-- Written as a status rather than an event because it is the offer's own condition, and because
-- the next thing built on top of it -- the owner replying yes -- has to be able to ask "which
-- offers are waiting" without reconstructing that from a log.
--
-- 'sent' still means the customer has it. Nothing reaches that state in this change: no letter
-- carrying a figure goes anywhere except to the owner, and that is enforced in the composing code
-- rather than by which row happens to say a wording may go out alone. A price is not one edit in a
-- table away from leaving unread.

BEGIN;

ALTER TABLE offers DROP CONSTRAINT offers_status_known;
ALTER TABLE offers ADD CONSTRAINT offers_status_known
    CHECK (status IN ('draft', 'awaiting_approval', 'sent', 'accepted', 'declined', 'expired'));

COMMENT ON COLUMN offers.status IS
    'draft: worked out, nobody has seen it. awaiting_approval: put in front of the owner and not answered. sent: the customer has it. Then accepted, declined or expired.';

COMMIT;
