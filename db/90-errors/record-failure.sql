INSERT INTO failures (source, workflow_name, workflow_id, execution_id, node_name,
  message, gmail_message_id, payload)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
RETURNING id, source, node_name, message;
