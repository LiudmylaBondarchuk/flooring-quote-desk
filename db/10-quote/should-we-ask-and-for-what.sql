-- Whether to ask the customer anything, and if so which words to use.
--
-- The rule that matters is asking once. Two emails a minute apart, both without an area, must not
-- produce two identical requests — so this reads the order's own history rather than a flag: has
-- this same question already gone out, and has anything new arrived since it did?
--
-- Anything new arriving is permission to ask again, because the customer answered part of it and
-- the rest is still outstanding. The same question twice with nothing in between is not.
--
-- The template is chosen here rather than in code, so the decision about which words apply lives
-- next to the decision about whether to speak at all.

WITH mine AS (
  SELECT o.id,
         array_remove(ARRAY[
           CASE WHEN o.material_category IS NULL THEN 'material' END,
           CASE WHEN o.area_sqft IS NULL         THEN 'area'     END,
           CASE WHEN o.zone IS NULL              THEN 'location' END], NULL) AS still_missing
    FROM orders o
   WHERE o.id = $2::int
     AND o.state NOT IN ('booked', 'done', 'lost')
),
last_ask AS (
  -- field, not just kind: a reminder is also an 'asked' event, and without this the nudge sent
  -- to a customer who went quiet would read as the question having changed
  SELECT created_at, new_value
    FROM order_events
   WHERE order_id = $2::int AND kind = 'asked' AND field = 'still_missing'
   ORDER BY created_at DESC
   LIMIT 1
),
arrived_since AS (
  SELECT count(*) AS n
    FROM order_events
   WHERE order_id = $2::int
     AND kind IN ('merged', 'corrected')
     AND created_at > coalesce((SELECT created_at FROM last_ask), '-infinity'::timestamptz)
),
letter AS (
  -- who wrote in, and which thread it belongs to. Whatever composes the reply used to reach back
  -- to an earlier node for this, and that node returns neither -- so a real run had nobody to
  -- write to while a test that handed the fields in passed. One query answers the whole question.
  SELECT contact_email, thread_id, auto_blocked, geo_zone
    FROM messages
   WHERE gmail_message_id = $1::text
),
-- What the job costs per square foot, which is the one thing a customer always wants and the desk
-- has never said. Narrowed to the material when the order names one, otherwise everything the firm
-- lays -- a range is a published rate, not a quote, and withholding it is the pause the desk exists
-- to remove.
rates AS (
  SELECT json_agg(json_build_object('product', b.product,
                                    'rate_low', b.rate_low,
                                    'rate_high', b.rate_high) ORDER BY b.rate_low, b.id) AS bands,
         min(b.rate_low)  AS lowest,
         max(b.rate_high) AS dearest
    FROM price_bands b
   WHERE b.active
     AND b.component = 'floor'
     AND (b.category = (SELECT material_category FROM orders WHERE id = $2::int)
          OR (SELECT material_category FROM orders WHERE id = $2::int) IS NULL)
),
-- The area only counts towards an illustration when the desk would actually take the job. A total
-- shown to somebody in Dallas is an invitation followed by a refusal.
figures AS (
  SELECT o.area_sqft, o.zone
    FROM orders o
   WHERE o.id = $2::int
),
decided AS (
  SELECT m.still_missing,
         array_to_string(m.still_missing, ',')                     AS asking_for,
         (SELECT new_value FROM last_ask)                          AS asked_before,
         (SELECT n FROM arrived_since)                             AS facts_since,
         cardinality(m.still_missing) > 0
           AND ((SELECT new_value FROM last_ask) IS DISTINCT FROM array_to_string(m.still_missing, ',')
                OR (SELECT n FROM arrived_since) > 0)              AS should_ask
    FROM mine m
)
SELECT
  $1::text                                                    AS gmail_message_id,
  $2::int                                                     AS order_id,
  coalesce(d.still_missing, ARRAY[]::text[])                  AS still_missing,
  d.asking_for,
  d.asked_before,
  coalesce(d.facts_since, 0)                                  AS facts_since,
  coalesce(d.should_ask, false)                               AS should_ask,
  -- whether there is anything to say at all, which is not the same as having a question. A
  -- property outside the service area is missing nothing -- the order knows the zone, it is simply
  -- one we do not serve -- so nothing was asked and nothing was said, and the customer heard
  -- silence. The branch downstream reads this, not should_ask.
  coalesce(d.should_ask, false) OR l.geo_zone = 'out'         AS should_speak,
  chosen.key                                                  AS template_key,
  chosen.body                                                 AS body,
  -- two permissions, and both must hold. The wording says what may be said with nobody reading
  -- it; the gate says whether THIS email may be answered at all. A commercial property or an
  -- email changing payment details is held whatever sentence was chosen -- and an enquiry that has
  -- merely not given the area yet is not held, because asking for it is the point.
  coalesce(chosen.sends_automatically AND NOT coalesce(l.auto_blocked, false), false)
                                                              AS may_go_alone,
  (SELECT body FROM reply_templates WHERE key = 'signature')  AS signature,
  l.contact_email,
  l.thread_id,
  -- the refusal comes first and beats everything below it: a customer who said Dallas has told us
  -- where they are, and asking them again is worse than saying no
  l.geo_zone = 'out'                                          AS out_of_area,
  (SELECT body FROM reply_templates WHERE key = 'out_of_area') AS out_of_area_words,
  (SELECT bands FROM rates)                                   AS bands,
  (SELECT body FROM reply_templates WHERE key = 'rates_preamble') AS rates_preamble,
  f.area_sqft,
  f.zone IS NOT NULL AND f.zone <> 'out'                      AS worth_illustrating
  FROM (SELECT 1) AS always
  LEFT JOIN decided d ON true
  LEFT JOIN letter  l ON true
  LEFT JOIN figures f ON true
  -- the words come back with the decision, so whatever composes the reply is only joining
  -- strings: one query answered whether to speak and what to say, and nothing downstream has to
  -- ask the database a second question to find out
  LEFT JOIN reply_templates chosen ON chosen.key = CASE
    WHEN d.still_missing @> ARRAY['material', 'area'] THEN 'needs_both'
    WHEN d.still_missing @> ARRAY['area']             THEN 'needs_area'
    WHEN d.still_missing @> ARRAY['material']         THEN 'needs_material'
    WHEN d.still_missing @> ARRAY['location']         THEN 'needs_location'
  END;
