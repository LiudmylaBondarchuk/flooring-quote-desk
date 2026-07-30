-- Orders nobody has heard from, and what to do about each.
--
-- Two ages, one pass. An order that has been silent past the first mark gets one nudge; one that
-- has been silent past the second is let go. The marks are arguments rather than numbers written
-- here, because how long is too long is the firm's judgement and not the query's.
--
-- Quiet means nothing has happened to the order, not that no email arrived: an order updated by a
-- merge, a quote, or an approval is a live conversation whatever the inbox looks like.
--
-- A nudge is sent once. The event is written after it goes, so an order with one already is past
-- nudging and waits for the second mark instead.

WITH live AS (
  SELECT o.id, o.contact_email, o.thread_id, o.state, o.updated_at,
         EXISTS (SELECT 1 FROM order_events e
                  WHERE e.order_id = o.id AND e.kind = 'asked' AND e.field = 'reminder') AS nudged,
         (SELECT m.gmail_message_id FROM messages m
           WHERE m.order_id = o.id AND m.is_outbound = false
           ORDER BY m.created_at DESC LIMIT 1)                                           AS reply_to
    FROM orders o
   WHERE o.state NOT IN ('booked', 'done', 'lost')
     AND o.closed_at IS NULL
)
SELECT
  l.id                                      AS order_id,
  l.contact_email,
  l.thread_id,
  l.reply_to,
  l.state,
  l.updated_at,
  l.nudged,
  (SELECT body FROM reply_templates WHERE key = 'nudge')      AS nudge,
  (SELECT body FROM reply_templates WHERE key = 'signature')  AS signature,
  CASE
    WHEN l.updated_at < now() - ($2::int * interval '1 day') THEN 'let go'
    WHEN l.nudged                                            THEN 'waiting'
    WHEN l.updated_at < now() - ($1::int * interval '1 day') THEN 'nudge'
    ELSE 'live'
  END                                                        AS what_now
  FROM live l
 WHERE l.reply_to IS NOT NULL
 ORDER BY l.updated_at;
