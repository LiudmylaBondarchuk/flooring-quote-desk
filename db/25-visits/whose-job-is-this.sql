-- Which job a booking belongs to, and whether we are sure enough to act on it.
--
-- The email is the ordinary case and needs no cooperation from the customer. The code is for when
-- the address typed into the booking form is not the one they write from -- a work account, a
-- spouse, a typo.
--
-- Which of the two is consulted first carries no weight, and saying otherwise would be a comment
-- describing a safety that is not there: when both answer they answer the same, and when they
-- disagree neither is taken. The refusal is what makes this safe, not the order. Swapping the two
-- around breaks no check, which is how that was found.
--
-- Only open jobs. A booking against a job already finished is a person's puzzle, not a row to
-- update, and matching one would move a visit onto work that is over.
--
-- And what they typed matters even when it matches nothing. A code that came back unreadable, or
-- readable and belonging to no open job, is a customer telling us something that disagrees with
-- what we would otherwise conclude -- and the ordinary conclusion is the email, which is right up
-- until the day somebody has two jobs open. Typing nothing is not disagreement; typing something
-- that leads nowhere is.

WITH by_email AS (
  SELECT o.id
    FROM orders o
   WHERE $1::text <> ''
     AND lower(o.contact_email) = lower($1::text)
     AND o.state NOT IN ('booked', 'done', 'lost')
   ORDER BY o.created_at DESC
   LIMIT 1
),
by_code AS (
  SELECT o.id
    FROM orders o
   WHERE $2::text <> ''
     AND o.booking_code = $2::text
     AND o.state NOT IN ('booked', 'done', 'lost')
   LIMIT 1
)
SELECT (SELECT id FROM by_email)                                  AS by_email,
       (SELECT id FROM by_code)                                   AS by_code,
       coalesce((SELECT id FROM by_email), (SELECT id FROM by_code)) AS order_id,
       CASE
         WHEN (SELECT id FROM by_email) IS NOT NULL
          AND (SELECT id FROM by_code) IS NOT NULL
          AND (SELECT id FROM by_email) <> (SELECT id FROM by_code) THEN 'they disagree'
         WHEN btrim($3::text) <> '' AND (SELECT id FROM by_code) IS NULL
           THEN 'they typed a code that matches nothing'
         WHEN (SELECT id FROM by_email) IS NOT NULL THEN 'the email'
         WHEN (SELECT id FROM by_code)  IS NOT NULL THEN 'the code'
         ELSE 'nothing matched'
       END                                                        AS matched_by,
       -- an email and a code pointing at different jobs is the one case where having two ways in
       -- is worse than having one: whichever we picked, we would be picking against evidence
       (((SELECT id FROM by_email) IS NOT NULL
         AND (SELECT id FROM by_code) IS NOT NULL
         AND (SELECT id FROM by_email) <> (SELECT id FROM by_code))
        OR (btrim($3::text) <> '' AND (SELECT id FROM by_code) IS NULL))  AS needs_a_person,
       (SELECT contact_email FROM orders
         WHERE id = coalesce((SELECT id FROM by_email), (SELECT id FROM by_code))) AS write_to;
