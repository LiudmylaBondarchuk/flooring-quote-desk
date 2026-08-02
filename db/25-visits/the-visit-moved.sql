-- The customer moved the booking, so the visit follows it.
--
-- The letter that already went out named the old time, and this does not send another: when the
-- desk cancels or moves anything the owner writes herself, and when a customer moves their own
-- booking Google has already told them what they now have. A third letter from us would be the
-- machine talking over both.
--
-- confirmed_at is cleared, so a moved visit is written about once more by the ordinary path -- the
-- customer has a letter naming a time that is no longer the time.

-- owner_told_at goes with it. What the owner was told names a time, and after this that time is
-- wrong: the customer has been moved and whoever is driving out has not. Clearing it puts the visit
-- back in front of the lane, which says it again with the time it now has.
--
-- And agreement_url with both. The copy prepared for this visit prints the old date on the page
-- somebody signs, and the lane that prepares one asks for visits that have none -- so leaving it
-- set does not leave a stale copy beside a fresh one, it leaves the stale one as the only one there
-- will ever be. The previous copy stays on Drive under its own name and date.
--
-- And the claim on it, for the same reason one step earlier. A visit that moves needs its page
-- remade now, and a claim taken by the run that was making the old one would hold it for half an
-- hour -- so the customer moves their booking and the desk sits still until a timer it has no
-- business waiting for runs out.

-- agreed_at moves with it. It is when this visit was agreed for the time it now has, and two lanes
-- measure a wait from it: the confirmation a quarter of an hour later, and the half hour after
-- which the owner is told even though no page exists yet. Left at the original agreement, both of
-- those waits are already over the moment a visit moves -- so a briefing goes out naming the new
-- time while the page still carries the old one, which is the exact thing the wait was added to
-- prevent.

UPDATE visits
   SET agreed = $2::timestamptz,
       agreed_at = now(),
       confirmed_at = NULL,
       owner_told_at = NULL,
       agreement_url = NULL,
       agreement_started_at = NULL
 WHERE id = $1::int
   AND state = 'agreed'
   AND agreed IS DISTINCT FROM $2::timestamptz
RETURNING id, order_id, agreed;
