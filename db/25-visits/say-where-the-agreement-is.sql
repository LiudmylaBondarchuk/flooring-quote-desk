-- The copy exists, and this is where. Guarded so a second run finds nothing to stamp rather than
-- pointing a visit at a second copy of itself.

UPDATE visits
   SET agreement_url = $2::text
 WHERE id = $1::int
   AND agreement_url IS NULL
RETURNING id, order_id, agreement_url;
