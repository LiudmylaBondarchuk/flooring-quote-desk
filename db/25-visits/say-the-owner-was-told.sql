-- The owner has been told, and this is when. Guarded so a second run finds nothing to stamp rather
-- than saying the same visit again in the same channel.

UPDATE visits
   SET owner_told_at = now()
 WHERE id = $1::int
   AND owner_told_at IS NULL
RETURNING id, order_id, owner_told_at;
