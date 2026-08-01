-- The code a customer types when they book a visit.
--
-- A booking arrives from Google with whatever email the person typed into the form, which is often
-- not the one they write from: a work address, a spouse's, a typo. Matching on that alone loses
-- bookings quietly, and guessing at the nearest order is worse than losing them.
--
-- So the letter that carries the booking link carries a code, and the booking form asks for it. The
-- code is a tiebreaker and never a gate: a booking with a matching email is matched on the email
-- whether the code is there or not, and one with neither goes to a person. Requiring the code would
-- lose the customers who ignored it, and losing a booking costs more than reading one more email.
--
-- The alphabet has no O, 0, I, 1 or L in it. Somebody is going to copy this by hand off a screen.

ALTER TABLE orders ADD COLUMN IF NOT EXISTS booking_code text;

-- The subquery mentions o.id, and it has to. Without a reference to the row being updated Postgres
-- may evaluate it once for the whole statement and give every order the same code -- which it did,
-- and the unique index below refused the lot. A backfill is the one place this is easy to miss,
-- because it is the only statement here that writes more than one row at a time.
UPDATE orders o SET booking_code = (
  SELECT string_agg(substr('23456789ABCDEFGHJKMNPQRSTUVWXYZ',
           (('x' || substr(md5(o.id::text || random()::text), i * 2 + 1, 2))::bit(8)::int % 30) + 1, 1), '')
    FROM generate_series(0, 6) AS i)
 WHERE o.booking_code IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS orders_booking_code_unique ON orders (booking_code);

COMMENT ON COLUMN orders.booking_code IS
    'Printed in the letter that carries the booking link, and asked for on the booking form. A tiebreaker when the email typed into the form is not the one on the order — never the only way in.';

-- Which Google booking a visit came from, so the same one delivered twice is recognised rather than
-- opening a second visit on one job. Null for a visit agreed by letter rather than by booking page.
ALTER TABLE visits ADD COLUMN IF NOT EXISTS booked_event_id text;

CREATE UNIQUE INDEX IF NOT EXISTS visits_one_per_booking ON visits (booked_event_id)
    WHERE booked_event_id IS NOT NULL;

COMMENT ON COLUMN visits.booked_event_id IS
    'The Google event a booking created. The trigger can deliver one twice; this is what makes the second delivery a no-op.';
