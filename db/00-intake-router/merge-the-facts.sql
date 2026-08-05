WITH trusted AS (
  -- $3 is what the gate said it stands behind, not everything it reported. An area it called
  -- implausible is absent from it while still being visible on the message for a person to read.
  --
  -- This used to guard on gate_color instead, and that was wrong in both directions on the same
  -- day: red covers a refused message and an incomplete one alike, so an ordinary "laminate,
  -- size to follow" contributed nothing, while an absurd area mid-conversation was only yellow
  -- and went straight in. Colour answers where an email goes. Whether a number can be a floor is
  -- a fact about the number.
  --
  -- Everything below reads the facts through here, not from the argument, so the part that
  -- updates the order and the part that writes the change log cannot disagree about what was
  -- believed.
  SELECT $3::jsonb AS facts
),
incoming AS (
  SELECT key, value #>> '{}' AS text_value
    FROM jsonb_each((SELECT facts FROM trusted))
   WHERE value <> 'null'::jsonb
     AND $2::int IS NOT NULL
),
before AS (
  -- FOR UPDATE, not for the update's sake: two messages merging into one order would otherwise
  -- both read this same snapshot, and the second would log "it was empty" for a field the first
  -- had already filled. Taking the row lock here makes the second wait and read what is true now.
  SELECT to_jsonb(o) AS row FROM orders o WHERE o.id = $2::int FOR UPDATE
),
changes AS (
  SELECT i.key AS field,
         (SELECT row FROM before)->>i.key AS old_value,
         i.text_value                     AS new_value
    FROM incoming i
   WHERE (SELECT row FROM before)->>i.key IS DISTINCT FROM i.text_value
),
applied AS (
  UPDATE orders o SET
    material_category     = coalesce((SELECT facts FROM trusted)->>'material_category',     o.material_category),
    area_sqft             = coalesce(((SELECT facts FROM trusted)->>'area_sqft')::numeric,  o.area_sqft),
    area_unit             = coalesce((SELECT facts FROM trusted)->>'area_unit',             o.area_unit),
    area_status           = coalesce((SELECT facts FROM trusted)->>'area_status',           o.area_status),
    city                  = coalesce((SELECT facts FROM trusted)->>'city',                  o.city),
    zone                  = coalesce((SELECT facts FROM trusted)->>'zone',                  o.zone),
    existing_floor_action = coalesce((SELECT facts FROM trusted)->>'existing_floor_action', o.existing_floor_action),
    fixing_method         = coalesce((SELECT facts FROM trusted)->>'fixing_method',         o.fixing_method),
    old_floor_removal     = coalesce(((SELECT facts FROM trusted)->>'old_floor_removal')::boolean, o.old_floor_removal),
    -- a set, not a value: a customer mentions the stairs once, in whichever letter they happen to
    -- be thinking about them, and a later letter that says nothing about them does not remove them
    on_site_items         = coalesce((SELECT array_agg(DISTINCT x) FROM unnest(
                              o.on_site_items || coalesce((SELECT array_agg(v)::text[] FROM jsonb_array_elements_text(
                                coalesce((SELECT facts FROM trusted)->'on_site_items', '[]'::jsonb)) v), '{}')) x), '{}'),
    updated_at            = now()
   WHERE o.id = $2::int
     -- reads before, so before is forced to run first. Without this the two are unordered and
     -- FOR UPDATE lets the snapshot re-read the row this very statement has already written,
     -- which shows up as a correction never being logged as one.
     AND (SELECT row FROM before) IS NOT NULL
  RETURNING o.*
),
logged AS (
  INSERT INTO order_events (order_id, gmail_message_id, kind, field, old_value, new_value)
  SELECT $2::int, $1, CASE WHEN c.old_value IS NULL THEN 'merged' ELSE 'corrected' END,
         c.field, c.old_value, c.new_value
    FROM changes c
  RETURNING 1
),
-- Whether this letter is the one that completed the job, which is a question only this statement
-- can answer.
--
-- The gate decides where a letter goes before the facts it carries have been merged, so it judges
-- the job as it stood a moment ago. A customer asked for the size, who answers with the size and
-- nothing else, is a letter naming no material and no town -- and the gate quite correctly files it
-- as somebody carrying on a conversation, and sends it to a lane that has nothing to do with a job
-- in that state. The desk asks for what it needs, gets it, and says nothing back.
--
-- The order after the merge is what settles it, and it is right here. Only where a price is the
-- thing that was waiting: an offer already exists means this is not that moment, out of area means
-- there is no price to give, and a closed job is not reopened by a late letter.
--
-- Kept to the categories the gate would itself have called ready. Anything it decided earlier in
-- its ladder -- a complaint, an answer to an offer, money, a date -- was decided on words in this
-- letter rather than on the state of the job, and is not for this to overturn.
--
-- Both questions are asked of the functions the quote lane asks, so there is one answer rather than
-- two that can drift apart. a_job_is_fully_described takes the row this statement has just written,
-- not the table: everything in here shares one snapshot, so reading orders would answer about the
-- job as it stood before this letter, which is the mistake being fixed. This letter is named to the
-- hold because it is not filed against the order until further down.
ready AS (
  SELECT coalesce(a_job_is_fully_described(a)
         AND NOT a_job_is_held_for_a_person(a.id, $1)
         AND $4::text IN ('existing_project', 'unknown')
         AND NOT EXISTS (SELECT 1 FROM offers f WHERE f.order_id = a.id), false)
                                                  AS price_is_what_was_waiting
    FROM applied a
   -- reads logged, so the change log is forced to run first, for the same reason applied reads
   -- before. Pulling on applied from here is enough to make the planner run the update early, and
   -- then the locking read in before returns the row this statement has just written -- so a
   -- corrected value looks like the value it always had and is never logged as a correction.
   WHERE (SELECT count(*) FROM logged) >= 0
),
linked AS (
  UPDATE messages SET
    order_id     = $2::int,
    -- and the record says the same thing the routing does, in the same breath: leaving route at
    -- what the gate said would make the only account of why a letter went where it went disagree
    -- with where it actually went.
    route        = CASE WHEN (SELECT price_is_what_was_waiting FROM ready)
                        THEN 'quote' ELSE route END,
    matched_rule = CASE WHEN (SELECT price_is_what_was_waiting FROM ready)
                        THEN 'the_job_is_ready' ELSE matched_rule END
   WHERE gmail_message_id = $1 AND $2::int IS NOT NULL
  RETURNING route
)
SELECT
  $1::text                                   AS gmail_message_id,
  $4::text                                   AS category,
  coalesce((SELECT route FROM linked), $5::text)
                                             AS route,
  $6::text                                   AS handling,
  $7::text                                   AS gate_color,
  a.id                                       AS order_id,
  a.state                                    AS order_state,
  a.material_category, a.area_sqft, a.area_unit, a.zone,
  a.existing_floor_action, a.fixing_method, a.old_floor_removal,
  (SELECT count(*) FROM logged)::int         AS facts_written,
  (SELECT count(*) FROM linked)::int         AS message_linked,
  (SELECT count(*) FROM changes
    WHERE old_value IS NOT NULL)::int        AS facts_corrected,
  CASE WHEN a.id IS NULL THEN ARRAY[]::text[]
       ELSE array_remove(ARRAY[
         CASE WHEN a.material_category IS NULL THEN 'material' END,
         CASE WHEN a.area_sqft IS NULL THEN 'area_sqft' END,
         CASE WHEN a.zone IS NULL THEN 'location' END], NULL)
  END                                        AS still_missing
  FROM (SELECT 1) AS always
  LEFT JOIN applied a ON true;
