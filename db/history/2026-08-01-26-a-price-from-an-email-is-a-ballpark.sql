-- What kind of price a customer was given, and what accepting it may do.
--
-- Everything this desk has ever quoted was worked out from a letter: a material, a number the
-- customer typed, and a town. That is a ballpark, and accepting one cannot start work -- nobody has
-- seen the floor. Until now the distinction lived only in the plan, and orders had nowhere to go
-- after 'quoted' at all: 'booked' was read as an exclusion by eight statements and set by none.
--
-- kind is 'ballpark' by default and every row that exists today is backfilled to it, because every
-- row that exists today was priced from an email. 'firm' is what a price becomes after somebody has
-- stood in the room, which nothing in this system can do yet -- so the column is the boundary
-- written down before the code that needs it.

ALTER TABLE offers ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'ballpark';

UPDATE offers SET kind = 'ballpark' WHERE kind IS NULL;

ALTER TABLE offers DROP CONSTRAINT IF EXISTS offers_kind_known;
ALTER TABLE offers ADD CONSTRAINT offers_kind_known CHECK (kind IN ('ballpark', 'firm'));

COMMENT ON COLUMN offers.kind IS
    'ballpark: worked out from an email, so accepting it buys a visit and not a job. firm: given after somebody has seen the floor.';
