-- Everything a letter carrying a price is made of, in one statement: the figures as they were
-- written down, the job they belong to, who asked, and the words a person wrote to wrap around
-- them. Nothing downstream asks the database a second question.
--
-- The offer is read rather than recomputed. A quote given today has to still be explainable after
-- the price list has moved, and the only way that stays true is if the letter says what the offer
-- says -- not what the arithmetic would produce if it ran again now.

WITH the_offer AS (
  SELECT o.id, o.order_id, o.total_low, o.total_high, o.subtotal_low, o.subtotal_high,
         o.breakdown, o.status, o.pricing_version
    FROM offers o
   WHERE o.id = $2::int
),
the_job AS (
  SELECT j.id, j.material_category, j.area_sqft, j.area_unit, j.city, j.zone, j.state
    FROM orders j
   WHERE j.id = (SELECT order_id FROM the_offer)
),
the_letter AS (
  -- the subject as it arrived, because the draft goes into the customer's own conversation and
  -- Gmail stitches a thread from the subject as well as from the thread id. A draft carrying a
  -- subject of its own would sit beside the conversation rather than in it.
  SELECT contact_email, thread_id, from_name, auto_blocked,
         raw_email ->> 'subject' AS subject
    FROM messages
   WHERE gmail_message_id = $1::text
),
words AS (
  SELECT max(body) FILTER (WHERE key = 'quote_opening') AS opening,
         max(body) FILTER (WHERE key = 'quote_closing') AS closing,
         max(body) FILTER (WHERE key = 'signature')     AS signature
    FROM reply_templates
   WHERE key IN ('quote_opening', 'quote_closing', 'signature')
)
SELECT
  $1::text                                  AS gmail_message_id,
  f.id                                      AS offer_id,
  f.order_id,
  f.total_low, f.total_high,
  f.breakdown,
  f.pricing_version,
  j.material_category, j.area_sqft, j.city,
  l.contact_email, l.thread_id, l.from_name, l.subject,
  coalesce(l.auto_blocked, false)           AS auto_blocked,
  w.opening, w.closing, w.signature,
  f.id IS NOT NULL
    AND f.total_low IS NOT NULL
    AND f.status = 'draft'
    AND w.opening IS NOT NULL
    AND w.closing IS NOT NULL                AS ready_to_write
  FROM the_offer f
  LEFT JOIN the_job    j ON true
  LEFT JOIN the_letter l ON true
  LEFT JOIN words      w ON true;
