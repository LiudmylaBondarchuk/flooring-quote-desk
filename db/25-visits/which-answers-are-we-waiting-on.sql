-- Bookings held while somebody looks at the town they were made from.
--
-- Old enough to have been seen. Slack takes a moment to accept a message and a person takes longer
-- than that to read one, so asking straight away only ever finds no answer.
--
-- No upper limit here on purpose. A booking nobody answers is not a booking that stops mattering,
-- and quietly abandoning the question after a day would confirm nothing and call nothing off --
-- the visit would simply arrive with nobody having decided anything about it.

SELECT v.id                        AS visit_id,
       v.order_id,
       v.site_check_ts,
       v.site_check_channel,
       v.site_check_asked_at,
       o.city                      AS priced_for,
       o.site_city                 AS booked_from,
       o.state                     AS state_was
  FROM visits v
  JOIN orders o ON o.id = v.order_id
 WHERE v.site_check_ts IS NOT NULL
   AND v.site_agreed IS NULL
   AND v.state = 'agreed'
   AND v.site_check_asked_at < now() - ($1::int * interval '1 second')
 ORDER BY v.site_check_asked_at;
