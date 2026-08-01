-- The things a price cannot be worked out for from a letter.
--
-- Stairs vary -- straight, winder, open-sided, with a landing -- and a model counting them from an
-- email is guessing at a number the owner then has to honour. The same is true of "three rooms and
-- a hallway" with no figure, and of what is under the old covering.
--
-- Until now the word "stairs" made the whole email unpriceable: the gate marked the scope unknown,
-- which holds it for a person, so a customer who mentioned a staircase got no number for their
-- floor either. The floor is perfectly priceable. What cannot be priced is named, given its own
-- per-unit range, kept out of the total, and left for the visit.
--
-- It belongs to the order and not to the message, because a customer mentions the stairs once, in
-- whichever letter they happen to be thinking about them.

ALTER TABLE orders ADD COLUMN IF NOT EXISTS on_site_items text[] NOT NULL DEFAULT '{}';

ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_on_site_items_known;
ALTER TABLE orders ADD CONSTRAINT orders_on_site_items_known
    CHECK (on_site_items <@ ARRAY['stairs']::text[]);

COMMENT ON COLUMN orders.on_site_items IS
    'What this job holds that a letter cannot put a price on. Named in the quote with a per-unit range, never added to the total, settled by the visit.';
