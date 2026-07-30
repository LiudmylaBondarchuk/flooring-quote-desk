-- The gate has always worked out whether an email may be acted on without a person seeing it. It
-- kept the answer to itself: the flag lived in a local variable, decided whether a price could be
-- quoted, and was thrown away.
--
-- That was harmless while nothing was sent. It stopped being harmless the moment the desk began
-- answering customers, because the only permission the sending step could see was the one on the
-- wording -- "may this sentence go out unread" -- and a sentence is the same sentence whoever it is
-- being sent to. So a commercial enquiry, which the gate marks never-auto, and an email trying to
-- change payment details, which the gate says to verify by phone, both received an automatic reply.
--
-- Nothing leaked: the letter asks for square footage and carries no figure. But the gate's verdict
-- was being ignored by the lane that answers, and the two permissions are different questions. The
-- wording says what may be said unread; this says whether THIS email may be answered at all.
--
-- Deliberately not the same as red. An enquiry that simply has not given the area yet is red and is
-- exactly the one worth answering automatically -- asking is the whole point. Being held back is
-- narrower: a fabricated value, a commercial property, a fully quoted reply, a platform lead with no
-- address, an ambiguous unit, or payment details being changed.
--
-- NULL on rows decided before this column existed, which reads as "nobody said", and the lane that
-- answers treats that as not blocked -- the same behaviour those rows already had.

BEGIN;

ALTER TABLE messages ADD COLUMN auto_blocked boolean;

COMMENT ON COLUMN messages.auto_blocked IS
    'True when the gate says a person must see this email before anything automatic happens to it. Distinct from gate_color: an enquiry missing the area is red and not blocked, because asking for it is the right automatic answer.';

ALTER TABLE messages ADD CONSTRAINT messages_pricing_needs_nobody_looking
    CHECK (pricing_allowed = false OR auto_blocked IS NOT TRUE);

COMMIT;
