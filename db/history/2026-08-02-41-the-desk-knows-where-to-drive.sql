-- Where the work actually is, as the customer typed it on the booking form.
--
-- Until now the desk knew a city and nothing else: whatever the extractor pulled out of prose, so
-- "Kyle TX" in a sentence and no street at all. Somebody was expected to drive to a visit with a
-- town name. The address on the agreement was a blank line filled in at the door, which is a fair
-- description of how much the desk knew.
--
-- Three columns rather than one, because a single box gets "123 Oak Street" and nothing else, and a
-- street with no town is not somewhere anybody can drive to. The postcode is kept apart from the
-- rest because service_area holds zones by postcode as well as by name -- it is the one part of an
-- address this desk can check rather than believe.
--
-- Left beside city and zone rather than replacing them: those two are what a price was worked out
-- from, and a booking arriving afterwards must not quietly change the ground a quote already
-- stands on. When the two disagree, that is worth somebody knowing, and it is not this migration's
-- business to decide it.

ALTER TABLE orders ADD COLUMN IF NOT EXISTS site_street   text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS site_city     text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS site_postcode text;

COMMENT ON COLUMN orders.site_street IS
    'The street the customer typed on the booking form. Null until they have booked. Never extracted from a letter.';
COMMENT ON COLUMN orders.site_postcode IS
    'The postcode the customer typed on the booking form, which service_area can be checked against by postcode rather than by name.';
