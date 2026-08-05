-- Clear facts on an order that no one but the desk ever stated.
--
-- The companion to putting back what an outbound letter overwrote, and it exists because that one
-- cannot see these. An order opens by gathering what the thread said before it existed, and that
-- gathering read the desk's own letters along with the customer's. Facts arriving that way are
-- written into the order as it is created, so there is no event recording them and nothing for a
-- repair to reverse.
--
-- What is left to go on is the settled object on each message, which is exactly the right thing:
-- it is what the gate stood behind at the time. A field the customer has spoken about at any point
-- is theirs and is left alone, whatever the desk also said about it. A field only the desk ever
-- named, still holding the value the desk gave it, was never the customer's and goes back to
-- nothing -- the same state as never having been asked.
--
-- Only the fields an order is described by. on_site_items is a set, gathered rather than replaced,
-- and clearing it wholesale would take the stairs out of a job that mentioned them.

WITH said_by_us AS (
  SELECT o.id AS order_id, f.key AS field, f.value #>> '{}' AS value
    FROM orders o
    JOIN messages m ON m.thread_id = o.thread_id AND m.direction = 'outbound'
    CROSS JOIN LATERAL jsonb_each(coalesce(m.settled, '{}'::jsonb)) f
   WHERE f.value <> 'null'::jsonb
     AND f.key IN ('material_category', 'area_sqft', 'area_unit', 'area_status',
                   'city', 'zone', 'existing_floor_action', 'fixing_method', 'old_floor_removal')
),
said_by_them AS (
  SELECT o.id AS order_id, f.key AS field
    FROM orders o
    JOIN messages m ON m.thread_id = o.thread_id AND m.direction = 'inbound'
    CROSS JOIN LATERAL jsonb_each(coalesce(m.settled, '{}'::jsonb)) f
   WHERE f.value <> 'null'::jsonb
),
ours_alone AS (
  SELECT u.order_id, jsonb_object_agg(u.field, u.value) AS was
    FROM (SELECT DISTINCT order_id, field, value FROM said_by_us) u
    JOIN orders o ON o.id = u.order_id
   WHERE NOT EXISTS (SELECT 1 FROM said_by_them t
                      WHERE t.order_id = u.order_id AND t.field = u.field)
     -- and the order still holds what we gave it. Anything since overwritten is somebody else's
     -- business now, and running this a second time finds nothing.
     AND to_jsonb(o)->>u.field IS NOT DISTINCT FROM u.value
   GROUP BY u.order_id
),
cleared AS (
  UPDATE orders o SET
    material_category     = CASE WHEN a.was ? 'material_category'     THEN NULL ELSE o.material_category END,
    area_sqft             = CASE WHEN a.was ? 'area_sqft'             THEN NULL ELSE o.area_sqft END,
    area_unit             = CASE WHEN a.was ? 'area_unit'             THEN NULL ELSE o.area_unit END,
    area_status           = CASE WHEN a.was ? 'area_status'           THEN NULL ELSE o.area_status END,
    city                  = CASE WHEN a.was ? 'city'                  THEN NULL ELSE o.city END,
    zone                  = CASE WHEN a.was ? 'zone'                  THEN NULL ELSE o.zone END,
    existing_floor_action = CASE WHEN a.was ? 'existing_floor_action' THEN NULL ELSE o.existing_floor_action END,
    fixing_method         = CASE WHEN a.was ? 'fixing_method'         THEN NULL ELSE o.fixing_method END,
    old_floor_removal     = CASE WHEN a.was ? 'old_floor_removal'     THEN NULL ELSE o.old_floor_removal END,
    updated_at            = now()
   FROM ours_alone a
  WHERE o.id = a.order_id
  RETURNING o.id, a.was
),
written_down AS (
  INSERT INTO order_events (order_id, gmail_message_id, kind, field, old_value, new_value)
  SELECT c.id, NULL, 'corrected', f.key, f.value #>> '{}', NULL
    FROM cleared c, jsonb_each(c.was) f
  RETURNING 1
)
SELECT c.id, f.key AS field, f.value #>> '{}' AS was, NULL AS now_again
  FROM cleared c, jsonb_each(c.was) f
 ORDER BY c.id, f.key;
