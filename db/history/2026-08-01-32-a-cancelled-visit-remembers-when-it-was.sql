-- A visit that was called off still knows when it was going to be.
--
-- The constraint said a time is present exactly when the state is 'agreed', which was true while
-- 'lapsed' meant one thing: an offer of times nobody ever answered. It now means two, because a
-- booking can be agreed and then cancelled -- by the customer on Google's own page, or by the owner
-- deleting a morning from her calendar.
--
-- Forcing that row to give up its time would leave no record that anybody was ever coming, which is
-- the opposite of what a cancellation is worth remembering. So the rule keeps the half that matters
-- -- an agreed visit has a time -- and drops the half that has stopped being true.

ALTER TABLE visits DROP CONSTRAINT IF EXISTS visits_agreed_has_a_time;
ALTER TABLE visits ADD CONSTRAINT visits_agreed_has_a_time
    CHECK (state <> 'agreed' OR agreed IS NOT NULL);
