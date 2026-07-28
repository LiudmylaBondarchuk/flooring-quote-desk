BEGIN;

COMMENT ON COLUMN messages.area_sqft IS
    'Square feet the gate accepted, when it accepted one. area_status says how the number got there, and its own constraint says what that can be.';

COMMIT;
