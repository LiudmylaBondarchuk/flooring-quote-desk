-- Recorded after the letter has gone. Without an order there is nowhere to put an event, so this
-- marks the message itself: the desk answered this question, and a redelivery will not answer it
-- twice.

UPDATE messages
   SET handled_by = '10 Quote — Flooring (answered a question)',
       handoff_at = now(),
       status = 'closed'
 WHERE gmail_message_id = $1::text
   AND handled_by IS DISTINCT FROM '10 Quote — Flooring (answered a question)'
RETURNING gmail_message_id, status, handled_by;
