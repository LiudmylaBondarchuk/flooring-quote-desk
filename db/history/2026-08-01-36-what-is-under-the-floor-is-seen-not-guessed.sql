-- Moisture and an uneven slab join the list of things a letter cannot price.
--
-- A subfloor flag turned the message red and stopped there. The quote lane works out its own colour
-- from the order, and the flag never reached the order -- so a job with a moisture flag was priced
-- exactly like one without, and did not even carry the assumption that the floor under it is sound,
-- because that sentence lives in a branch the flag skips.
--
-- It belongs with stairs: named, given the firm's own rate, kept out of the total, settled by
-- somebody standing on it. Levelling a slab is per square foot rather than per step, which the
-- breakdown already handles -- a line with a rate and no quantity.

ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_on_site_items_known;
ALTER TABLE orders ADD CONSTRAINT orders_on_site_items_known
    CHECK (on_site_items <@ ARRAY['stairs', 'subfloor']::text[]);
