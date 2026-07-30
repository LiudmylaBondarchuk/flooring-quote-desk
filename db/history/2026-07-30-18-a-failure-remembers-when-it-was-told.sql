-- Failures have been recorded since the first schema and nobody has ever been told about one. The
-- node at the end of that lane is called "TODO notify the maintainer" and does nothing, so every
-- other guarantee in this system has quietly depended on somebody thinking to look at a table.
--
-- The row already says whether it was told. It does not say when, and without that the only two
-- available behaviours are both wrong: tell nobody, or send one letter per failure -- which on the
-- morning something breaks in a loop means a hundred letters and a person who stops reading them.
--
-- With a time on it, a burst becomes one letter carrying everything still untold, and the next
-- letter waits until the quiet window has passed. Nothing is dropped: a failure not told in this
-- letter is still untold, and the next letter carries it.
--
-- The limit worth stating: the letter is sent when a failure arrives. If failures stop inside the
-- quiet window, the last of them stay untold until something else fails. Sweeping those up is the
-- watchman's job, and the watchman is parked.

BEGIN;

ALTER TABLE failures ADD COLUMN notified_at timestamptz;

COMMENT ON COLUMN failures.notified_at IS
    'When somebody was told about this failure. NULL means nobody has been, which is what notified = false has always meant; the time is what makes it possible to answer "have we written recently" without sending one letter per failure.';

COMMIT;
