-- The customer moved the booking, so the visit follows it.
--
-- The letter that already went out named the old time, and this does not send another: when the
-- desk cancels or moves anything the owner writes herself, and when a customer moves their own
-- booking Google has already told them what they now have. A third letter from us would be the
-- machine talking over both.
--
-- confirmed_at is cleared, so a moved visit is written about once more by the ordinary path -- the
-- customer has a letter naming a time that is no longer the time.

UPDATE visits
   SET agreed = $2::timestamptz,
       confirmed_at = NULL
 WHERE id = $1::int
   AND state = 'agreed'
   AND agreed IS DISTINCT FROM $2::timestamptz
RETURNING id, order_id, agreed;
