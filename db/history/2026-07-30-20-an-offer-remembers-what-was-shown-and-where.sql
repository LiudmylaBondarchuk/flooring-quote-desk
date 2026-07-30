-- An offer waits at awaiting_approval and nothing can find its way back to it. Two facts are
-- missing, and neither can be worked out later.
--
-- The first is which conversation the owner was asked in. Her answer arrives as an ordinary email
-- and has to be matched to the offer it answers; the only thing tying them together is the thread
-- the letter went out in, which Gmail gives back when it accepts the letter and nobody records.
--
-- The second is the letter itself. It would be possible to build it again from the offer when she
-- says yes, and it would be wrong: the price list can move between the two moments, the wording is
-- a row somebody can edit, and what reaches the customer must be what she read. She approves a
-- text, not a recipe for one.
--
-- Both are about the round of approval that is open, so both are emptied when a new letter is put
-- forward and neither is history: order_events already holds that.

BEGIN;

ALTER TABLE offers ADD COLUMN approval_thread_id text;
ALTER TABLE offers ADD COLUMN letter_text text;

COMMENT ON COLUMN offers.approval_thread_id IS
    'The Gmail thread the owner was asked in. Her reply arrives in it, and it is the only thing tying an answer to the offer it answers.';
COMMENT ON COLUMN offers.letter_text IS
    'The letter as she read it. What reaches the customer is this, never a fresh calculation: she approves a text, not a recipe for one.';

CREATE INDEX offers_awaiting_approval_idx ON offers (approval_thread_id)
    WHERE status = 'awaiting_approval';

COMMIT;

-- The owner's answer has to reach somewhere. Everything the desk sends to itself comes back as an
-- owner_reply, and until now that was routed to 'log' -- written down and dropped. It gets a lane,
-- so the one message in a hundred that says "send it" can be acted on. The other ninety-nine reach
-- the lane, find no offer waiting in their thread, and stop there.
--
-- Run this before deploying the router: a message routed to a value the constraint does not know
-- is refused, and the refusal happens after the model has already been paid for.

BEGIN;

ALTER TABLE messages DROP CONSTRAINT messages_route_known;
ALTER TABLE messages ADD CONSTRAINT messages_route_known
    CHECK (route IN ('quote', 'project', 'support', 'operations', 'review', 'approval', 'log'));

COMMIT;
