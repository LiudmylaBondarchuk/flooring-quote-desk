-- The job facts that go on the agreement, for agreed visits that have no copy of it yet -- and, in
-- the same breath, the claim that says this run is the one making it.
--
-- Asking and claiming are one statement on purpose. When they were two -- a read, then a copy on
-- Drive, then a write saying the copy exists -- everything between the read and the write was
-- unguarded, and copying a document and filling ten placeholders lives in there. Two runs
-- overlapping inside those seconds both saw a visit with no page and both made one. Ten copies of
-- one agreement in twenty minutes, every run reporting success.
--
-- An UPDATE takes a row lock, so of two runs arriving together one waits, then re-checks these
-- conditions against the row the other just wrote -- and finds agreement_started_at set, and takes
-- nothing. That re-check is why every condition is in this statement's own WHERE rather than in a
-- subquery it selects from: the conditions Postgres re-tests are the ones written here.
--
-- The half hour is the escape. A claim that never lifted would turn one failure at Google into a
-- visit with no page for ever, which is a worse trade than the copies it prevents. It is far longer
-- than the seconds this lane needs and far shorter than the wait before anybody drives anywhere.
--
-- Read off the job, never off the newest letter -- the same reason as everywhere else here: a
-- customer says "laminate, Kyle TX" one day and "about 400 sq ft" the next, and a document built
-- from either letter alone goes to a door with half the job on it.
--
-- No price of any kind is selected, and that is deliberate. The ballpark belongs in what the owner
-- is told and nowhere near the page a customer signs: a number from an email, printed on an
-- agreement, is an argument waiting at the door. The only price on that page is the one written
-- there by hand once the floor has been measured.

WITH claimed AS (
    UPDATE visits v
       SET agreement_started_at = now()
     WHERE v.state = 'agreed'
       AND v.agreement_url IS NULL
       AND v.agreed > now()
       AND (v.agreement_started_at IS NULL
            OR v.agreement_started_at < now() - interval '30 minutes')
       AND EXISTS (SELECT 1 FROM orders o
                    WHERE o.id = v.order_id
                      AND o.state NOT IN ('done', 'lost'))
    RETURNING v.id, v.order_id, v.agreed
)
SELECT c.id                                   AS visit_id,
       c.order_id,
       c.agreed,
       o.contact_email,
       o.city,
       o.material_category,
       o.area_sqft,
       o.area_unit,
       o.existing_floor_action,
       o.on_site_items,
       o.booking_code,
       o.site_street,
       o.site_city,
       o.site_postcode,
       (SELECT body FROM reply_templates WHERE key = 'agreement_template') AS template_id
  FROM claimed c
  JOIN orders o ON o.id = c.order_id
 ORDER BY c.agreed;
