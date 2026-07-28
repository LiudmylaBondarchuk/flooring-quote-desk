-- messages_area_sane was removed once because it was written as a business rule: a bound
-- tight enough to be plausible swallowed a 25 000 sq ft commercial job whole. This puts it
-- back as what a constraint is for — catching the absurd, not the unusual. A negative area,
-- a zero, a phone number or a price landing in the field cannot be a floor.
--
-- The business range stays where it can explain itself: the gate flags anything outside
-- 20 to 20 000 sq ft with a reason, and refuses to price it, while still storing the number
-- so a human can see what was said.
--
-- Safe to add only because a refused write is now visible: Save triage hands its error to
-- the fallback, which writes a red row naming the constraint and hands off to 50 Review.

BEGIN;

ALTER TABLE messages ADD CONSTRAINT messages_area_sane
    CHECK (area_sqft IS NULL OR (area_sqft > 0 AND area_sqft < 1000000));

COMMIT;
