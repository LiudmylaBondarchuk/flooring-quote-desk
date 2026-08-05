-- Undo the facts an order took from a letter the desk itself wrote.
--
-- Until the gate stopped settling anything from its own replies, every letter the desk sent was
-- read for facts about the customer. The firm signs each one with its own address, and describes
-- what a price covers -- so a customer in Round Rock was moved to Austin, and the sentence "taking
-- the old covering away" became a decision about their floor. Neither came from them.
--
-- Reversed from the order's own history rather than by hand: every one of those facts was written
-- down with what it replaced, so what it replaced is what goes back. Newest first, so a field
-- touched twice ends on the oldest value the desk did not invent.
--
-- The reversal is recorded as an event of its own. An order whose history simply lost three lines
-- would be an order nobody could later explain.

WITH ours AS (
  SELECT e.id, e.order_id, e.gmail_message_id, e.field, e.old_value, e.new_value,
         row_number() OVER (PARTITION BY e.order_id, e.field ORDER BY e.created_at DESC) AS newest
    FROM order_events e
    JOIN messages m ON m.gmail_message_id = e.gmail_message_id
    JOIN orders   o ON o.id = e.order_id
   WHERE m.direction = 'outbound'
     AND e.kind IN ('merged', 'corrected')
     -- and only where the order still holds what our letter put there. Run twice, the second run
     -- finds nothing and writes nothing; a field the customer has since spoken about for themselves
     -- is left alone, because their word is newer than this repair. The cost is that a value whose
     -- text no longer matches how it is stored is passed over rather than guessed at -- doing
     -- nothing is the safe failure for a repair, and it says so in what it returns.
     AND to_jsonb(o)->>e.field IS NOT DISTINCT FROM e.new_value
),
undo AS (
  SELECT order_id, jsonb_object_agg(field, old_value) AS put_back,
         jsonb_object_agg(field, new_value)           AS was
    FROM ours WHERE newest = 1
   GROUP BY order_id
),
put_back AS (
  UPDATE orders o SET
    city = CASE WHEN u.put_back ? 'city'
                            THEN (u.put_back->>'city') ELSE o.city END,
    zone = CASE WHEN u.put_back ? 'zone'
                            THEN (u.put_back->>'zone') ELSE o.zone END,
    material_category = CASE WHEN u.put_back ? 'material_category'
                            THEN (u.put_back->>'material_category') ELSE o.material_category END,
    area_sqft = CASE WHEN u.put_back ? 'area_sqft'
                            THEN (u.put_back->>'area_sqft')::numeric ELSE o.area_sqft END,
    area_unit = CASE WHEN u.put_back ? 'area_unit'
                            THEN (u.put_back->>'area_unit') ELSE o.area_unit END,
    area_status = CASE WHEN u.put_back ? 'area_status'
                            THEN (u.put_back->>'area_status') ELSE o.area_status END,
    existing_floor_action = CASE WHEN u.put_back ? 'existing_floor_action'
                            THEN (u.put_back->>'existing_floor_action') ELSE o.existing_floor_action END,
    fixing_method = CASE WHEN u.put_back ? 'fixing_method'
                            THEN (u.put_back->>'fixing_method') ELSE o.fixing_method END,
    old_floor_removal = CASE WHEN u.put_back ? 'old_floor_removal'
                            THEN (u.put_back->>'old_floor_removal')::boolean ELSE o.old_floor_removal END,
    updated_at            = now()
   FROM undo u
  WHERE o.id = u.order_id
  RETURNING o.id, u.was, u.put_back
),
written_down AS (
  INSERT INTO order_events (order_id, gmail_message_id, kind, field, old_value, new_value)
  SELECT p.id, NULL, 'corrected', f.key, p.was->>f.key, f.value #>> '{}'
    FROM put_back p, jsonb_each(p.put_back) f
  RETURNING 1
)
SELECT p.id, f.key AS field, p.was->>f.key AS was, f.value #>> '{}' AS now_again
  FROM put_back p, jsonb_each(p.put_back) f
 ORDER BY p.id, f.key;
