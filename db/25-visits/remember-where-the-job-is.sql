-- What the customer typed on the booking form, kept against the job.
--
-- coalesce rather than assignment: a rebooking that leaves a question blank must not wipe what the
-- last one answered. The newest thing said is the truth; silence is not a thing said.

UPDATE orders
   SET site_street   = coalesce($2::text, site_street),
       site_city     = coalesce($3::text, site_city),
       site_postcode = coalesce($4::text, site_postcode),
       updated_at    = now()
 WHERE id = $1::int
-- order_id rather than id, because the next node in the lane binds $json.order_id and a column
-- named anything else arrives there as nothing. The visit insert then refuses an empty parameter
-- and no visit is recorded -- a booking that vanishes, from a rename.
-- and whether the town they booked from is the town the price was worked out for. Nothing here
-- decides anything about it: the two are compared with case and spacing ignored, because "kyle" and
-- "Kyle" are the same town written twice, and anything else is said out loud for a person to look
-- at. A typo and a different city look identical from here, and only one of them matters -- but the
-- one that matters is a job priced for one town and a van driven to another, sometimes outside the
-- area the firm works at all.
RETURNING id AS order_id, site_street, site_city, site_postcode,
          city AS priced_for,
          coalesce(lower(btrim(site_city)) <> lower(btrim(city)), false) AS two_towns;
