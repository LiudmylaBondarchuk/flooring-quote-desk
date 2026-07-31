-- The gate already tells acceptance from haggling: one branch decides both, and the difference
-- ends up in the sentence a person reads and nowhere a statement can use it. So the lane that
-- handles a reply to a quote would have to read the words a second time, with a second copy of the
-- vocabulary, and the first thing a second copy does is disagree.
--
-- One column. 'accepted' is somebody saying go ahead; 'pushed_back' is somebody saying it is too
-- much. NULL is every other email, which is nearly all of them.
--
-- Deliberately not a boolean. A reply to a quote that is neither is a real thing -- a question
-- about the timing, a change of material -- and it must not read as a refusal.

BEGIN;

ALTER TABLE messages ADD COLUMN offer_answer text;

ALTER TABLE messages ADD CONSTRAINT messages_offer_answer_known
    CHECK (offer_answer IS NULL OR offer_answer IN ('accepted', 'pushed_back'));

COMMENT ON COLUMN messages.offer_answer IS
    'Which way a reply to a quote went: accepted, pushed_back, or NULL when it was neither. Decided by the gate, so no other place has to read the words again.';

COMMIT;
