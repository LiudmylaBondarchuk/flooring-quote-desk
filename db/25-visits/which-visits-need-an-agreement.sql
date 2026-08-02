-- The job facts that go on the agreement, for agreed visits that have no copy of it yet.
--
-- Read off the job, never off the newest letter -- the same reason as everywhere else here: a
-- customer says "laminate, Kyle TX" one day and "about 400 sq ft" the next, and a document built
-- from either letter alone goes to a door with half the job on it.
--
-- No price of any kind is selected, and that is deliberate. The ballpark belongs in what the owner
-- is told and nowhere near the page a customer signs: a number from an email, printed on an
-- agreement, is an argument waiting at the door. The only price on that page is the one written
-- there by hand once the floor has been measured.
--
-- Only visits still ahead of us, and only those without a copy: agreement_url being null is what
-- makes this run once.

SELECT v.id                                   AS visit_id,
       v.order_id,
       v.agreed,
       o.contact_email,
       o.city,
       o.material_category,
       o.area_sqft,
       o.area_unit,
       o.existing_floor_action,
       o.on_site_items,
       o.booking_code,
       (SELECT body FROM reply_templates WHERE key = 'agreement_template') AS template_id
  FROM visits v
  JOIN orders o ON o.id = v.order_id
 WHERE v.state = 'agreed'
   AND v.agreement_url IS NULL
   AND v.agreed > now()
   AND o.state NOT IN ('done', 'lost')
 ORDER BY v.agreed;
