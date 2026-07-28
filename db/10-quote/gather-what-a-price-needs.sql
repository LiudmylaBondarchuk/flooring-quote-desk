-- Everything the arithmetic needs, in one row, assembled where the facts actually live.
--
-- The three fields that decide whether a price may be quoted at all come from the message being
-- handled: whether pricing is allowed, what colour the gate gave it, and whether the enquiry is
-- residential. They belong to this email and to no other.
--
-- Everything the price is computed from comes from the order, because that is what the
-- conversation has accumulated. The email that named the material may be three weeks and four
-- messages behind the one that finally gave the area.
--
-- Only active price bands. A band switched off in the spreadsheet is a product the firm no longer
-- offers, and quoting it because it is still in the table is how a customer is sold something
-- that cannot be delivered.

SELECT
  m.gmail_message_id,
  m.pricing_allowed,
  m.gate_color,
  m.segment,
  o.id                                  AS order_id,
  o.material_category,
  o.area_sqft,
  o.area_status,
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
              FROM pricing_rules r), '{}'::json)                  AS rules
  FROM messages m
  LEFT JOIN orders o ON o.id = m.order_id
 WHERE m.gmail_message_id = $1;
