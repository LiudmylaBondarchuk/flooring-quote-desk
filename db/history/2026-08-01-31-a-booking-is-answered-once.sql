-- When the desk said something about a booking, so it says it once and not on the minute it lands.
--
-- Google sends its own confirmation the instant somebody books, and a second letter arriving in the
-- same breath reads as a machine talking to itself. The desk waits, and then says the thing Google
-- cannot: which job this is, what it holds, and that a person will be at the door.
--
-- The wait is a column and not a pause in a workflow. A pause is a sleeping execution that nothing
-- here can run, and a lane that cannot be run against a database cannot be shown to be right. This
-- can: a statement asks which visits are old enough and unanswered, and that question has an answer
-- at any moment, on any row, in a test.

ALTER TABLE visits ADD COLUMN IF NOT EXISTS confirmed_at timestamptz;

COMMENT ON COLUMN visits.confirmed_at IS
    'When the desk wrote to the customer about this booking. Null means it has not, and is what makes the sending happen once.';

INSERT INTO reply_templates (key, body, sends_automatically, notes) VALUES
  ('visit_confirmed_opening',
   'That is booked in — thank you.

I have the visit down as below, along with the job as I have it so far. If any of that looks wrong, just reply to this email and I will put it right.',
   true,
   'sent a quarter of an hour after a booking, not on the instant: Google has already sent its own confirmation and two letters at once read as a machine talking to itself'),
  ('visit_confirmed_closing',
   'There is nothing to prepare. It helps if the rooms are walkable and I can see the existing floor, but that is all.',
   true,
   'after the time and the job, because it answers what the customer does next')
ON CONFLICT (key) DO NOTHING;
