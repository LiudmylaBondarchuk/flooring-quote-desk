-- An order may hold the areas the gate will stand behind, and no others.
--
-- The constraint allowed anything under a million. The gate settles an area only between 20 and
-- 20000 square feet, so every value in between was refused by the code and permitted by the
-- database -- a guard the width of a barn door, agreeing with nothing.
--
-- messages is deliberately left as it is. A message holds what the customer reported, including
-- figures the gate looked at and refused: somebody who writes "40000 sq ft" gets no price and their
-- letter still has to show a person what they said. An order holds only what was settled.

ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_area_sane;
ALTER TABLE orders ADD CONSTRAINT orders_area_sane
    CHECK (area_sqft IS NULL OR (area_sqft >= 20 AND area_sqft <= 20000));
