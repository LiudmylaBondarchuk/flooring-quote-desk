WITH open_in_thread AS (
  SELECT id FROM orders
   WHERE thread_id = $2
     AND state NOT IN ('booked', 'done', 'lost')
   ORDER BY created_at DESC
   LIMIT 1
),
already_said AS (
  -- What the thread has said before this order existed. A question about capability opens no
  -- order — it is not work yet — so the material the gate recognised in it has nowhere to go, and
  -- without this the customer is asked again for what they already wrote.
  --
  -- Read from settled, never from the reported columns: the number a person sees on a message can
  -- be one the gate refused, and messages.area_sqft holds it. The latest message to have settled a
  -- field wins, because a customer who corrects themselves means the correction.
  SELECT
    (array_agg(settled ->> 'material_category' ORDER BY created_at DESC)
       FILTER (WHERE settled ->> 'material_category' IS NOT NULL))[1] AS material_category,
    (array_agg(settled ->> 'area_sqft' ORDER BY created_at DESC)
       FILTER (WHERE settled ->> 'area_sqft' IS NOT NULL))[1]         AS area_sqft,
    (array_agg(settled ->> 'area_unit' ORDER BY created_at DESC)
       FILTER (WHERE settled ->> 'area_unit' IS NOT NULL))[1]         AS area_unit,
    (array_agg(settled ->> 'area_status' ORDER BY created_at DESC)
       FILTER (WHERE settled ->> 'area_status' IS NOT NULL))[1]       AS area_status,
    (array_agg(settled ->> 'city' ORDER BY created_at DESC)
       FILTER (WHERE settled ->> 'city' IS NOT NULL))[1]              AS city,
    (array_agg(settled ->> 'zone' ORDER BY created_at DESC)
       FILTER (WHERE settled ->> 'zone' IS NOT NULL))[1]              AS zone,
    (array_agg(settled ->> 'existing_floor_action' ORDER BY created_at DESC)
       FILTER (WHERE settled ->> 'existing_floor_action' IS NOT NULL))[1] AS existing_floor_action,
    (array_agg(settled ->> 'fixing_method' ORDER BY created_at DESC)
       FILTER (WHERE settled ->> 'fixing_method' IS NOT NULL))[1]     AS fixing_method,
    (array_agg(settled ->> 'old_floor_removal' ORDER BY created_at DESC)
       FILTER (WHERE settled ->> 'old_floor_removal' IS NOT NULL))[1] AS old_floor_removal,
    -- a set gathered across the whole thread, not the newest letter's answer: stairs are mentioned
    -- once and stay mentioned
    (SELECT array_agg(DISTINCT v) FROM messages m2,
            jsonb_array_elements_text(coalesce(m2.settled -> 'on_site_items', '[]'::jsonb)) v
      WHERE m2.thread_id = $2 AND m2.order_id IS NULL AND m2.gmail_message_id <> $1) AS on_site_items
    FROM messages
   WHERE thread_id = $2
     AND order_id IS NULL
     AND gmail_message_id <> $1
),
made AS (
  INSERT INTO orders (contact_email, thread_id, material_category, area_sqft, area_unit, area_status,
                      city, zone, existing_floor_action, fixing_method, old_floor_removal,
                      on_site_items)
  SELECT $3, $2, t.material_category, t.area_sqft::numeric, t.area_unit, t.area_status,
         t.city, t.zone, t.existing_floor_action, t.fixing_method, t.old_floor_removal::boolean,
         coalesce(t.on_site_items, '{}')
    FROM already_said t
   WHERE NOT EXISTS (SELECT 1 FROM open_in_thread)
     AND $4::boolean
  RETURNING id
),
born AS (
  INSERT INTO order_events (order_id, gmail_message_id, kind)
  SELECT id, $1, 'created' FROM made
  RETURNING 1
)
SELECT
  $1::text                                        AS gmail_message_id,
  coalesce((SELECT id FROM open_in_thread),
           (SELECT id FROM made))                 AS order_id,
  (SELECT count(*) FROM born)::int = 1            AS order_was_created,
  (SELECT count(*) FROM open_in_thread)::int = 1  AS order_was_found;
