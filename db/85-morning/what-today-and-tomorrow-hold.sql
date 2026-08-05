-- Every visit standing today and tomorrow, in the days as they are in Texas, gathered into one row.
--
-- One row on purpose, and always one. A morning with nothing in it is the morning this exists for:
-- if the line does not arrive, something has stopped -- the mail, the desk, the machine -- and
-- somebody notices over their first coffee rather than at the end of the week. A statement that
-- returned no rows on a quiet day would take the whole lane down with it, and the silence that is
-- supposed to mean "broken" would mean "nothing on".
--
-- The days are cut in the timezone the work is in, not the one the server keeps. A visit at seven in
-- the evening in Austin is tomorrow already in UTC, and putting it under "tomorrow" for somebody
-- about to drive to it this evening is worse than saying nothing.
--
-- Lapsed visits are left out: a job called off is not a place anybody is going. One nobody has
-- confirmed to the customer is left in, because it is still a booking in a calendar and somebody
-- may still turn up for it -- and that is worth knowing before the day starts rather than after.

WITH here AS (
  SELECT (now() AT TIME ZONE 'America/Chicago')::date AS today
),
standing AS (
  SELECT v.id                                            AS visit_id,
         v.order_id,
         v.agreed,
         CASE WHEN (v.agreed AT TIME ZONE 'America/Chicago')::date = (SELECT today FROM here)
              THEN 'today' ELSE 'tomorrow' END           AS when_it_is,
         v.confirmed_at IS NOT NULL                      AS customer_told,
         v.site_agreed,
         v.agreement_url IS NOT NULL                     AS page_ready,
         o.contact_email,
         o.material_category, o.area_sqft, o.area_unit,
         coalesce(o.site_city, o.city)                   AS town,
         o.site_street, o.booking_code
    FROM visits v
    JOIN orders o ON o.id = v.order_id
   WHERE v.state = 'agreed'
     AND (v.agreed AT TIME ZONE 'America/Chicago')::date
         BETWEEN (SELECT today FROM here) AND (SELECT today FROM here) + 1
)
-- As text, not as a date. A date column crosses the wire as an instant -- Postgres hands it over as
-- midnight in the server's timezone, and the driver turns that into "2026-08-04T22:00:00.000Z" for
-- a day that is the fifth. The calendar day cannot be recovered from an instant without knowing the
-- timezone it was midnight in, so nothing downstream can repair it; it has to leave here as the day
-- it is.
SELECT (SELECT today FROM here)::text                    AS the_day,
       coalesce((SELECT json_agg(s ORDER BY s.agreed) FROM standing s), '[]'::json) AS visits;
