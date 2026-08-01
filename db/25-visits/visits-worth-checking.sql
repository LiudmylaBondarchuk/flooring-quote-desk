-- Visits the calendar might have changed under us, and what we believe about each.
--
-- Only ones that came from a booking -- a visit agreed by letter has no Google event to compare
-- against -- and only ones still ahead of us. What happened to a visit last March is history, and
-- reconciling history against a calendar that has since been tidied would rewrite the record of
-- what was true at the time.

SELECT v.id                AS visit_id,
       v.order_id,
       v.booked_event_id,
       v.agreed,
       v.confirmed_at IS NOT NULL AS was_told
  FROM visits v
  JOIN orders o ON o.id = v.order_id
 WHERE v.state = 'agreed'
   AND v.booked_event_id IS NOT NULL
   AND v.agreed > now() - interval '1 day'
   AND o.state NOT IN ('done', 'lost')
 ORDER BY v.agreed;
