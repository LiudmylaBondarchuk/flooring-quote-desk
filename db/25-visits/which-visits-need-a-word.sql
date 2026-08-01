-- Bookings the desk has not answered yet, and everything a letter about one needs.
--
-- Old enough, and only once. The wait is here rather than in a pause inside a workflow, so that
-- "which bookings are waiting" is a question with an answer on any row at any moment -- including
-- in a test, which a sleeping execution never is.
--
-- The address comes from the order and never from the booking form. Somebody who typed a code that
-- was not theirs must not be told what is on that job.

SELECT v.id                              AS visit_id,
       v.order_id,
       v.agreed,
       o.contact_email                   AS write_to,
       o.material_category,
       o.area_sqft,
       o.area_unit,
       o.city,
       o.on_site_items,
       (SELECT body FROM reply_templates WHERE key = 'visit_confirmed_opening') AS opening,
       (SELECT body FROM reply_templates WHERE key = 'visit_confirmed_closing') AS closing,
       (SELECT body FROM reply_templates WHERE key = 'signature')       AS signature
  FROM visits v
  JOIN orders o ON o.id = v.order_id
 WHERE v.state = 'agreed'
   AND v.confirmed_at IS NULL
   AND v.agreed_at < now() - ($1::int * interval '1 minute')
   AND o.contact_email IS NOT NULL
   AND o.state NOT IN ('done', 'lost')
 ORDER BY v.agreed_at;
