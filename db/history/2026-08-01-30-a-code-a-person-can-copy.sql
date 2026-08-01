-- Five letters and two digits, and nothing else in it.
--
-- The first shape was seven characters drawn from one mixed alphabet, and it read as noise: a
-- person copying it off a screen into a booking form has no idea whether they have the right
-- number of characters or whether that was an eight or a B. Letters then digits gives the eye a
-- shape to check against, and the two halves are drawn from alphabets with nothing ambiguous in
-- them: no I, O or L among the letters, no 0 or 1 among the digits.
--
-- No separator. A hyphen looks tidy in a letter and is the first thing somebody leaves out when
-- they type it back, and a code that is only right when punctuated is a code that fails on people
-- who were doing their best.
--
-- 23^5 x 8^2 is about 412 million, which is enough for a firm that will never have ten thousand
-- open jobs.

UPDATE orders o SET booking_code =
  (SELECT string_agg(substr('ABCDEFGHJKMNPQRSTUVWXYZ',
     (('x' || substr(md5(o.id::text || 'letters' || random()::text), i * 2 + 1, 2))::bit(8)::int % 23) + 1, 1), '')
     FROM generate_series(0, 4) AS i)
  ||
  (SELECT string_agg(substr('23456789',
     (('x' || substr(md5(o.id::text || 'digits' || random()::text), i * 2 + 1, 2))::bit(8)::int % 8) + 1, 1), '')
     FROM generate_series(0, 1) AS i);

ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_booking_code_shape;
ALTER TABLE orders ADD CONSTRAINT orders_booking_code_shape
    CHECK (booking_code IS NULL OR booking_code ~ '^[ABCDEFGHJKMNPQRSTUVWXYZ]{5}[23456789]{2}$');
