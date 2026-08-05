-- Quotes written and left unsent, and how many times the owner has been told about each.
--
-- A draft announces itself once, when it is written, and after that it is as quiet as the customer
-- waiting for it. One had been sitting for five days before anybody noticed, and nothing in the
-- system was wrong -- there was simply nobody whose job it was to look again.
--
-- Twice, and then never. A line that repeats until it is obeyed is a line people mute, and a muted
-- channel is the same as no channel at all. So the second telling is also the last, and it says so;
-- what happens after it is that the job is closed rather than chased.
--
-- Counted per offer rather than per order, because an order can be quoted more than once and the
-- second quote deserves its own two tellings.

WITH chases AS (
  SELECT (e.new_value)::int AS offer_id,
         count(*)::int      AS so_far,
         max(e.created_at)  AS last_time
    FROM order_events e
   WHERE e.kind = 'asked' AND e.field = 'the_owner'
     AND e.new_value ~ '^[0-9]+$'
   GROUP BY 1
)
SELECT f.id                              AS offer_id,
       f.order_id,
       o.state                           AS state_now,
       f.total_low, f.total_high,
       f.approval_thread_id              AS thread_id,
       o.material_category, o.area_sqft, o.city,
       o.contact_email,
       coalesce(c.so_far, 0)             AS said_before,
       coalesce(c.so_far, 0) + 1 >= 2    AS the_last_time,
       date_part('hour', now() - f.created_at)::int AS hours_waiting
  FROM offers f
  JOIN orders o ON o.id = f.order_id
  LEFT JOIN chases c ON c.offer_id = f.id
 WHERE f.status = 'awaiting_approval'
   -- a job somebody has already finished, booked or given up on is not waiting on this letter
   AND o.state NOT IN ('booked', 'done', 'lost')
   AND f.created_at < now() - ($1::int * interval '1 hour')
   AND coalesce(c.so_far, 0) < 2
   AND coalesce(c.last_time, '-infinity'::timestamptz) < now() - ($1::int * interval '1 hour')
 ORDER BY f.created_at;
