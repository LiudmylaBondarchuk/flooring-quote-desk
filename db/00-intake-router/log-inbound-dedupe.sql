WITH ins AS (
INSERT INTO messages (
  gmail_message_id, internet_message_id, thread_id, direction, sender,
  contact_email, from_name, source, needs_sender_extraction,
  body, body_raw, body_html, body_fully_quoted, body_empty,
  has_photo, image_count, pdf_count,
  auto_submitted, precedence, list_unsubscribe, contract_version,
  is_outbound, raw_email, status, created_at)
VALUES ($1,$2,$3,$21,$22,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$23,$20::jsonb,'new',now())
ON CONFLICT (gmail_message_id) DO NOTHING
  RETURNING id
)
SELECT
  $1::text AS gmail_message_id,
  (SELECT count(*) FROM ins) = 0 AS was_duplicate;
