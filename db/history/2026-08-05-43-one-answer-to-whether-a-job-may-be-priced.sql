-- Whether a job may be priced, written down once.
--
-- Two questions decide it, and until now each was answered in more than one place. Whether the job
-- is described well enough to cost was in the gate's JavaScript, in the router's merge and in the
-- quote lane's own gathering. Whether somebody has hold of it -- a letter flagged, a letter held
-- back, a managing agent's letter -- was in the quote lane only, until the router began to need it
-- too.
--
-- Copies of a rule drift, and the drift does not announce itself. The router's copy said a held job
-- was ready and sent it to the lane, whose copy refused it; the job had nothing missing to ask
-- about, so nothing was said to the customer and nothing was passed to the owner.
--
-- A function taking the order row rather than reading the table, because the router has to ask
-- about the row it is in the middle of writing. Everything inside one statement sees the same
-- snapshot, so anything that reads orders would answer about the job as it stood before this
-- letter -- which is the very mistake being fixed.

CREATE OR REPLACE FUNCTION a_job_is_fully_described(job orders) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT job.material_category IS NOT NULL
     AND job.area_sqft IS NOT NULL
     AND job.zone IS NOT NULL
     AND job.zone <> 'out'
     AND job.state NOT IN ('booked', 'done', 'lost')
$$;

-- One letter being held holds the whole job: a commercial property does not stop being one because
-- the next letter is ordinary.
--
-- and_this_letter names a letter that is not on the order yet. The router asks while the letter is
-- still being filed, so without it the letter that raises the flag is the one letter the check
-- cannot see. The quote lane passes null, because by then everything is filed.
CREATE OR REPLACE FUNCTION a_job_is_held_for_a_person(job_id int, and_this_letter text)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM messages x
                  WHERE (x.order_id = job_id OR x.gmail_message_id = and_this_letter)
                    AND (x.danger OR coalesce(x.auto_blocked, false) OR x.segment = 'commercial'))
$$;
