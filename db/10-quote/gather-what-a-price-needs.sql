-- Everything the arithmetic needs, in one row, assembled where the facts actually live.
--
-- Whether a price may be quoted is a question about the JOB, not about the last email. It used to
-- be read off the message being handled, and that made the conversation this system exists for
-- impossible to finish: a customer who writes "laminate, kyle tx" and then "about 400 sq ft" sends
-- a second email that names no town, so the gate colours it red and asks for one -- while the order
-- it belongs to has had the town since the first letter. The order was complete and nothing could
-- ever be priced.
--
-- So the permission is assembled here from the order and from every message that has touched it: is
-- the job fully described, is it somewhere the firm works, has nothing about it been held back for
-- a person. The names are the ones the arithmetic already reads, because what it needed all along
-- was a verdict about the job.
--
-- Everything the price is computed from comes from the order, because that is what the
-- conversation has accumulated. The email that named the material may be three weeks and four
-- messages behind the one that finally gave the area.
--
-- Only active price bands. A band switched off in the spreadsheet is a product the firm no longer
-- offers, and quoting it because it is still in the table is how a customer is sold something
-- that cannot be delivered.

-- Both questions are asked of the same functions the router asks before sending anything here, so
-- that the two lanes cannot come to different answers about the same job. Null, because by the time
-- a job reaches this lane every letter in the conversation is filed against it.
WITH job AS (
  SELECT o.id,
         a_job_is_fully_described(o)                                             AS fully_described,
         NOT a_job_is_held_for_a_person(o.id, NULL)                              AS free_to_price,
         EXISTS (SELECT 1 FROM messages x
                  WHERE x.order_id = o.id AND x.segment = 'commercial')          AS commercial
    FROM orders o
)
SELECT
  m.gmail_message_id,
  coalesce(j.fully_described AND j.free_to_price, false)   AS pricing_allowed,
  CASE WHEN coalesce(j.fully_described AND j.free_to_price, false)
       THEN 'green' ELSE m.gate_color END                                        AS gate_color,
  CASE WHEN j.commercial THEN 'commercial' ELSE m.segment END                    AS segment,
  m.gate_color                                                                   AS this_email_was,
  o.id                                  AS order_id,
  o.material_category,
  o.area_sqft,
  o.area_status,
  o.zone,
  o.area_status IS NOT NULL             AS area_comparable,
  coalesce(o.old_floor_removal, false)  AS old_floor_removal,
  coalesce((SELECT json_agg(json_build_object(
              'category',    b.category,
              'product',     b.product,
              'unit',        b.unit,
              'rate_low',    b.rate_low,
              'rate_high',   b.rate_high,
              'wastage_pct', b.wastage_pct,
              'min_charge',  b.min_charge) ORDER BY b.id)
              FROM price_bands b
             WHERE b.active
               AND b.category = o.material_category), '[]'::json) AS bands,
  coalesce((SELECT json_object_agg(r.rule_key,
              json_build_object('val_low', r.val_low, 'val_high', r.val_high))
              FROM pricing_rules r), '{}'::json)                  AS rules,
  coalesce(o.on_site_items, '{}')                                 AS on_site_items,
  -- what a step costs, taken from the price list and not from the floor material: a customer laying
  -- laminate still has stairs, and the stairs band is the firm's rate for a step whatever is on the
  -- floor below it
  -- what each of these costs, from wherever this firm keeps that rate. Stairs are a price band,
  -- because they are a product with a unit; levelling a slab is a pricing rule, because it is
  -- labour per square foot. Both arrive under the name the job knows them by.
  (coalesce((SELECT jsonb_object_agg(b.component,
               jsonb_build_object('label', b.product, 'unit', b.unit,
                                  'val_low', b.rate_low, 'val_high', b.rate_high))
               FROM price_bands b
              WHERE b.active AND b.component = 'stairs'), '{}'::jsonb)
   || coalesce((SELECT jsonb_build_object('subfloor',
                  jsonb_build_object('label', 'levelling and moisture work', 'unit', 'sqft',
                                     'val_low', r.val_low, 'val_high', r.val_high))
                  FROM pricing_rules r
                 WHERE r.rule_key = 'subfloor_leveling'), '{}'::jsonb))    AS on_site_rates
  FROM messages m
  LEFT JOIN orders o ON o.id = m.order_id
  LEFT JOIN job    j ON j.id = o.id
 WHERE m.gmail_message_id = $1;
