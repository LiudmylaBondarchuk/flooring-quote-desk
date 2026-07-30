-- Written after the letter has gone, never before. If sending fails nothing here runs, the rows
-- stay untold, and the next failure's letter carries them -- which is the right way round: a
-- failure nobody was told about must not be marked as told.

UPDATE failures
   SET notified = true, notified_at = now()
 WHERE id = ANY($1::int[])
   AND NOT notified
RETURNING id;
