-- Grounding checks that a value's words appear in the email. It does not read meaning, and no
-- regular expression will teach it to: "anything but laminate", "we do not want laminate" and
-- "laminate please" all contain the word, and the gate stands behind Laminate for all three. That
-- was run and watched before this was written.
--
-- So a second reader is asked, once per email, after the code has decided. It is given the whole
-- conversation rather than the newest letter -- reading one letter is the mistake this system keeps
-- making -- and it answers one question: does the decision hold together with what the customer
-- actually wrote.
--
-- Its only power is to raise auto_blocked, which already exists and already sends an email to a
-- person instead of answering it automatically. It cannot change a value, cannot unblock anything,
-- cannot route. Two models agreeing on a wrong answer is a real thing; this one can never turn a
-- refusal into a permission.
--
-- NULL means it was not asked, or did not answer, or answered something unusable. In all three
-- cases nothing changes and the code's decision stands: a reader that cannot speak must not be able
-- to stop the desk working.

BEGIN;

ALTER TABLE messages ADD COLUMN second_opinion text;
ALTER TABLE messages ADD COLUMN second_opinion_why text;

ALTER TABLE messages ADD CONSTRAINT messages_second_opinion_known
    CHECK (second_opinion IS NULL OR second_opinion IN ('holds', 'does_not_hold'));

ALTER TABLE messages ADD CONSTRAINT messages_second_opinion_says_why
    CHECK (second_opinion IS DISTINCT FROM 'does_not_hold' OR second_opinion_why IS NOT NULL);

COMMENT ON COLUMN messages.second_opinion IS
    'What a second reader made of the decision the code reached. NULL means it was not asked or could not answer, and then nothing changes.';
COMMENT ON COLUMN messages.second_opinion_why IS
    'One sentence, written for the owner rather than for a developer: what the customer said and what the system concluded. Required when the reader says the decision does not hold, because a raised hand with no reason is worse than none.';

COMMIT;
