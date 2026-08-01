-- The conversation, assembled for a reader who has not seen it.
--
-- The whole thread, not the newest letter. Reading one email is the mistake this system has made
-- three times in two days: a customer says "laminate, Kyle TX" on Monday and "about 400 sq ft" on
-- Tuesday, and any rule that looks only at Tuesday sees an email about nothing.
--
-- Bodies come with quoted history already stripped, the way the router stored them. Reading the raw
-- message would hand the reader the desk's own words back and invite it to judge those.
--
-- The letters and the history stop at the one being judged. The job block does not: orders hold no
-- snapshots, so it is always the job as it stands now. Live that is the same instant and the
-- distinction does not arise; replaying an old decision, it is what is left approximate here.

WITH letters AS (
  SELECT to_char(m.created_at, 'Mon DD HH24:MI') AS at,
         CASE WHEN m.is_outbound THEN 'the desk' ELSE 'the customer' END AS who,
         coalesce(nullif(btrim(m.body), ''), '(nothing readable)') AS said,
         m.created_at
    FROM messages m
   WHERE m.thread_id = $2::text
     -- Up to the letter being judged and never past it. Live this changes nothing: that letter is
     -- the newest there is. It matters when the question is asked again later -- measuring, or
     -- re-reading an old decision -- because by then the thread has grown, and handing over what
     -- arrived afterwards asks the reader to fault a decision for not knowing the future. It did
     -- exactly that: it accused the gate of ignoring an area the customer gave two minutes later.
     --
     -- coalesce, because a message id that is not on file would otherwise make this NULL and empty
     -- the conversation silently, which reads as "they wrote nothing" rather than as a broken call.
     AND m.created_at <= coalesce(
           (SELECT j.created_at FROM messages j WHERE j.gmail_message_id = $1::text),
           'infinity'::timestamptz)
   ORDER BY m.created_at
),
job AS (
  SELECT o.id, o.state, o.material_category, o.area_sqft, o.area_unit, o.city, o.zone
    FROM orders o
   WHERE o.thread_id = $2::text
     AND o.state NOT IN ('booked', 'done', 'lost')
   ORDER BY o.created_at DESC
   LIMIT 1
),
history AS (
  SELECT e.kind, e.field, e.old_value, e.new_value, e.created_at
    FROM order_events e
   WHERE e.order_id = (SELECT id FROM job)
     -- cut at the same instant as the letters, for the same reason
     AND e.created_at <= coalesce(
           (SELECT j.created_at FROM messages j WHERE j.gmail_message_id = $1::text),
           'infinity'::timestamptz)
   ORDER BY e.created_at
)
SELECT
  $1::text AS gmail_message_id,
  coalesce((SELECT string_agg(format('%s  %s: %s', at, who, said), E'\n' ORDER BY created_at)
              FROM letters), '(no letters on file)')                        AS conversation,
  -- "state" was the label here once, and a reader took it for a US state and complained that
  -- Texas had been recorded as "new". The words a reader is given are part of the question.
  coalesce((SELECT format(E'material wanted: %s\nfloor area:     %s %s\nproperty is in:  %s (%s of the service area)\nhow far along:  %s',
                          coalesce(j.material_category, 'not said yet'),
                          coalesce(j.area_sqft::text, 'not said yet'), coalesce(j.area_unit, ''),
                          coalesce(j.city, 'not said yet'), coalesce(j.zone, 'zone not known'), j.state)
              FROM job j), 'no job has been opened for this thread yet')     AS the_job,
  coalesce((SELECT string_agg(format('%s %s: %s -> %s', kind, field,
                                     coalesce(old_value, 'nothing'), coalesce(new_value, 'nothing')),
                              E'\n' ORDER BY created_at)
              FROM history), '(nothing has happened to it yet)')            AS what_happened;
