-- The sheet exists, and this is where. Guarded so a second run finds nothing to stamp rather than
-- pointing a visit at a second copy of itself.

UPDATE visits
   SET job_sheet_url = $2::text
 WHERE id = $1::int
   AND job_sheet_url IS NULL
RETURNING id, order_id, job_sheet_url;
