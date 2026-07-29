-- The quote lane refuses an area the gate did not call comparable, and until now it could only
-- learn that from the message being priced. An order is priced from what the conversation has
-- accumulated, and the message that supplied the area may be weeks behind.
--
-- Deriving it from the unit would be a guess: square feet can be a number the customer wrote or
-- one worked out from a room's dimensions, and those are known and derived, not the same thing.
-- The gate already decided; the order should keep the decision rather than reconstruct it.

BEGIN;

ALTER TABLE orders ADD COLUMN area_status text;

ALTER TABLE orders ADD CONSTRAINT orders_area_status_known CHECK (area_status IS NULL
    OR area_status IN ('known', 'converted', 'derived'));

COMMENT ON COLUMN orders.area_status IS
    'How the area was arrived at, carried from the message that settled it. Only the three the gate calls solid enough to price from can be here.';

COMMIT;
