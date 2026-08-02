-- When somebody started making this visit's copy of the agreement.
--
-- agreement_url was doing this job and could not do it. It is set *after* the copy exists on Drive,
-- and copying a document and filling ten placeholders takes seconds -- so two runs overlapping
-- inside those seconds both see a visit with no page and both make one. That is not a rare race: on
-- 2 August, with the clock at one minute, it made ten copies of one agreement in twenty minutes and
-- reported success every time.
--
-- The guard has to be taken *before* the thing that cannot be undone, in our own database, where
-- one statement can be atomic. This column is that mark. A run claims the visit first and only then
-- copies anything; a second run finds the visit already claimed and does nothing.
--
-- It expires after half an hour rather than lasting for ever. A claim that never lifts turns one
-- failure at Google into a visit that is pageless permanently -- ten copies traded for none, which
-- is the worse of the two. Half an hour is far longer than the seconds this lane needs and far
-- shorter than the wait before anybody drives anywhere.
--
-- Nothing backfills it. A visit that already has a page is excluded by agreement_url, and a visit
-- that has none is claimable now, which is what we want for both.

ALTER TABLE visits ADD COLUMN IF NOT EXISTS agreement_started_at timestamptz;

COMMENT ON COLUMN visits.agreement_started_at IS
    'When a run last claimed this visit to prepare its agreement. Taken before the copy is made on Drive, which is the whole point: agreement_url is written afterwards and so cannot stop a second run that is already underway. Cleared when a visit moves, and expires after 30 minutes so a failure at Google does not leave a visit claimed and pageless for ever.';
