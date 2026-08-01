-- Where the sheet for a visit was put, so it is written once and can be found again.
--
-- Null means no sheet, which is also what makes writing one idempotent: the trigger that creates
-- them asks for visits that have none, and a second delivery of the same booking finds nothing to
-- do rather than filling the owner's Drive with copies of one job.
--
-- The address is not a secret and is not treated as one -- anybody holding it can open the file --
-- so it lives here and nowhere a customer is ever shown. The sheet is for the person driving out.

ALTER TABLE visits ADD COLUMN IF NOT EXISTS job_sheet_url text;

COMMENT ON COLUMN visits.job_sheet_url IS
    'Where this visit''s job sheet was written on Drive. Null until one exists, which is what stops a second one being made. Never sent to the customer.';
