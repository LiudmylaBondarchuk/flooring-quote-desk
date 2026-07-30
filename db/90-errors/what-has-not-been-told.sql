-- Whether to write to the owner, and what the letter says. One statement, so the decision and the
-- words cannot disagree with each other, and so nothing downstream has to ask a second question.
--
-- The rule is one letter per quiet window rather than one per failure. A workflow failing in a loop
-- produces a failure a second; a hundred letters is the same as none, because nobody reads the
-- hundredth. So: if somebody was written to inside the window, stay quiet -- they already know
-- something is wrong and the next letter will carry these too.
--
-- Grouped by what actually distinguishes one failure from another to a person reading at seven in
-- the morning: which workflow, which node, and what it said. Twelve identical timeouts are one line
-- with a count, not twelve lines.

WITH untold AS (
  SELECT id, workflow_name, node_name, message, gmail_message_id, created_at
    FROM failures
   WHERE NOT notified
     AND resolved_at IS NULL
),
recently AS (
  SELECT count(*) AS n
    FROM failures
   WHERE notified_at > now() - ($1::int * interval '1 minute')
),
grouped AS (
  SELECT coalesce(workflow_name, 'unknown workflow') AS workflow_name,
         coalesce(node_name, 'no node named')        AS node_name,
         message,
         count(*)                                    AS times,
         max(created_at)                             AS last_seen,
         min(gmail_message_id)                       AS an_email
    FROM untold
   GROUP BY 1, 2, 3
   ORDER BY max(created_at) DESC
)
SELECT
  (SELECT count(*) FROM untold)::int                          AS untold,
  (SELECT n FROM recently)::int                                AS told_recently,
  (SELECT count(*) FROM untold) > 0
    AND (SELECT n FROM recently) = 0                           AS should_tell,
  coalesce((SELECT array_agg(id) FROM untold), ARRAY[]::int[]) AS ids,
  coalesce((SELECT string_agg(
      format('%s x%s  %s -> %s%s%s',
             to_char(last_seen, 'HH24:MI'), times, workflow_name, node_name,
             E'\n      ' || message,
             CASE WHEN an_email IS NULL THEN '' ELSE E'\n      email ' || an_email END),
      E'\n\n' ORDER BY last_seen DESC)
    FROM grouped), '') AS what_broke;
