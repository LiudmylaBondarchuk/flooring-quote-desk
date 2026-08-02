-- Everything the owner is told before a visit, for agreed visits nobody has been told about.
--
-- Read off the job, never off the newest letter. A customer says "laminate, Kyle TX" one day and
-- "about 400 sq ft" the next, and a message built from either letter alone sends somebody out
-- knowing half of it.
--
-- Only agreed visits still ahead of us, and only those nobody has been told about: owner_told_at
-- being null is what makes this run once. A visit that lapsed gets nothing -- nobody is driving
-- anywhere.
--
-- Ahead of us means ahead of now. This is read before somebody knocks, so a visit whose hour has
-- passed has nothing to prepare for: if the lane were down across the appointment, catching up
-- afterwards would announce a visit that already happened.

SELECT v.id                                   AS visit_id,
       v.order_id,
       v.agreed,
       o.contact_email,
       o.city,
       o.zone,
       o.material_category,
       o.area_sqft,
       o.area_unit,
       o.existing_floor_action,
       o.old_floor_removal,
       o.fixing_method,
       o.on_site_items,
       o.booking_code,
       o.site_street,
       o.site_city,
       o.site_postcode,
       v.agreement_url,
       -- a ballpark that actually went out. A draft or one still waiting on the owner's word has
       -- not been seen by anybody, and reading it out as "quoted by email" would send somebody to
       -- a door believing the customer expects a number nobody ever sent them.
       (SELECT jsonb_build_object('low', f.total_low, 'high', f.total_high, 'kind', f.kind)
          FROM offers f
         WHERE f.order_id = o.id
           AND f.kind = 'ballpark'
           AND f.status IN ('sent', 'accepted', 'declined', 'expired')
         ORDER BY f.created_at DESC
         LIMIT 1)                             AS ballpark,
       -- the rates for what the visit has to settle, from the price list rather than from anywhere
       -- a number could have been typed by hand
       (coalesce((SELECT jsonb_object_agg(b.component,
                    jsonb_build_object('label', b.product, 'unit', b.unit,
                                       'val_low', b.rate_low, 'val_high', b.rate_high))
                    FROM price_bands b
                   WHERE b.active AND b.component = 'stairs'), '{}'::jsonb)
        || coalesce((SELECT jsonb_build_object('subfloor',
                       jsonb_build_object('label', 'levelling and moisture work', 'unit', 'sqft',
                                          'val_low', r.val_low, 'val_high', r.val_high))
                       FROM pricing_rules r
                      WHERE r.rule_key = 'subfloor_leveling'), '{}'::jsonb)) AS on_site_rates
  FROM visits v
  JOIN orders o ON o.id = v.order_id
 WHERE v.state = 'agreed'
   AND v.owner_told_at IS NULL
   AND v.agreed > now()
   -- and not before the page for it exists, so one message carries everything: where to go, what
   -- the job is, and the document to open at the door. Half an hour is the escape -- if whatever
   -- makes that page is broken, the owner is told late rather than not at all, and the missing
   -- link says so on its own.
   AND (v.agreement_url IS NOT NULL OR v.agreed_at < now() - interval '30 minutes')
   AND o.state NOT IN ('done', 'lost')
 ORDER BY v.agreed;
