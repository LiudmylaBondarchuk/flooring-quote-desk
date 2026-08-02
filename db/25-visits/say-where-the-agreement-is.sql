-- The copy exists, and this is where. Guarded so a second run finds nothing to stamp rather than
-- pointing a visit at a second copy of itself.
--
-- And guarded on the time it was prepared for. Copying a document and filling it takes seconds, and
-- a customer can move the booking inside them: without this, the page printing the old date would be
-- filed against the moved visit, and agreement_url being set would then stop the right one ever
-- being prepared. If the visit moved while this was being made, nothing is stamped, the copy is left
-- on Drive under its own date, and the next run prepares the page the visit now needs.

UPDATE visits
   SET agreement_url = $2::text
 WHERE id = $1::int
   AND agreement_url IS NULL
   AND state = 'agreed'
   AND agreed = $3::timestamptz
RETURNING id, order_id, agreement_url;
