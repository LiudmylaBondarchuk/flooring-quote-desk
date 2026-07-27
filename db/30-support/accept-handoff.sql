UPDATE messages SET
  status     = $2,
  handled_by = $3,
  handoff_at = now()
WHERE gmail_message_id = $1
RETURNING gmail_message_id, category, handling, status, handled_by;
