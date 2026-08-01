-- What the owner gets before a visit stopped being a file and became a message.
--
-- A sheet on Drive has to be gone and opened; a message arrives on the phone of somebody already
-- in the van, and it lands somewhere that is not the mailbox every customer writes to. Competing
-- for attention with the day's work is the one thing this must not do.
--
-- So the address of a file is not what a visit needs to remember. What it needs to remember is
-- whether the owner has been told, which is what stops a second delivery of the same booking
-- saying it all again.
--
-- The column being dropped never reached main: it was added by a migration that ran on this
-- database from a branch that was not merged, and its file is in this repository so the ledger can
-- recognise what it already ran.

ALTER TABLE visits DROP COLUMN IF EXISTS job_sheet_url;
ALTER TABLE visits ADD COLUMN IF NOT EXISTS owner_told_at timestamptz;

COMMENT ON COLUMN visits.owner_told_at IS
    'When the owner was told about this visit. Null until they have been, which is what stops a second telling. What is said carries the ballpark and the rates, so it never goes to a customer.';
