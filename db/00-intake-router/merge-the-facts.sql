WITH incoming AS (
  SELECT key, value #>> '{}' AS text_value
    FROM jsonb_each($3::jsonb)
   WHERE value <> 'null'::jsonb
     AND $2::int IS NOT NULL
),
before AS (
  -- FOR UPDATE, not for the update's sake: two messages merging into one order would otherwise
  -- both read this same snapshot, and the second would log "it was empty" for a field the first
  -- had already filled. Taking the row lock here makes the second wait and read what is true now.
  SELECT to_jsonb(o) AS row FROM orders o WHERE o.id = $2::int FOR UPDATE
),
changes AS (
  SELECT i.key AS field,
         (SELECT row FROM before)->>i.key AS old_value,
         i.text_value                     AS new_value
    FROM incoming i
   WHERE (SELECT row FROM before)->>i.key IS DISTINCT FROM i.text_value
),
applied AS (
  UPDATE orders o SET
    material_category     = coalesce($3::jsonb->>'material_category',     o.material_category),
    area_sqft             = coalesce(($3::jsonb->>'area_sqft')::numeric,  o.area_sqft),
    area_unit             = coalesce($3::jsonb->>'area_unit',             o.area_unit),
    city                  = coalesce($3::jsonb->>'city',                  o.city),
    zone                  = coalesce($3::jsonb->>'zone',                  o.zone),
    existing_floor_action = coalesce($3::jsonb->>'existing_floor_action', o.existing_floor_action),
    fixing_method         = coalesce($3::jsonb->>'fixing_method',         o.fixing_method),
    old_floor_removal     = coalesce(($3::jsonb->>'old_floor_removal')::boolean, o.old_floor_removal),
    updated_at            = now()
   WHERE o.id = $2::int
     -- reads before, so before is forced to run first. Without this the two are unordered and
     -- FOR UPDATE lets the snapshot re-read the row this very statement has already written,
     -- which shows up as a correction never being logged as one.
     AND (SELECT row FROM before) IS NOT NULL
  RETURNING o.*
),
linked AS (
  UPDATE messages SET order_id = $2::int
   WHERE gmail_message_id = $1 AND $2::int IS NOT NULL
  RETURNING 1
),
logged AS (
  INSERT INTO order_events (order_id, gmail_message_id, kind, field, old_value, new_value)
  SELECT $2::int, $1, CASE WHEN c.old_value IS NULL THEN 'merged' ELSE 'corrected' END,
         c.field, c.old_value, c.new_value
    FROM changes c
  RETURNING 1
)
SELECT
  $1::text                                   AS gmail_message_id,
  $4::text                                   AS category,
  $5::text                                   AS route,
  $6::text                                   AS handling,
  $7::text                                   AS gate_color,
  a.id                                       AS order_id,
  a.state                                    AS order_state,
  a.material_category, a.area_sqft, a.area_unit, a.zone,
  a.existing_floor_action, a.fixing_method, a.old_floor_removal,
  (SELECT count(*) FROM logged)::int         AS facts_written,
  (SELECT count(*) FROM linked)::int         AS message_linked,
  (SELECT count(*) FROM changes
    WHERE old_value IS NOT NULL)::int        AS facts_corrected,
  CASE WHEN a.id IS NULL THEN ARRAY[]::text[]
       ELSE array_remove(ARRAY[
         CASE WHEN a.material_category IS NULL THEN 'material' END,
         CASE WHEN a.area_sqft IS NULL THEN 'area_sqft' END,
         CASE WHEN a.zone IS NULL THEN 'location' END], NULL)
  END                                        AS still_missing
  FROM (SELECT 1) AS always
  LEFT JOIN applied a ON true;
