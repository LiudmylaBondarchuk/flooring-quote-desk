UPDATE messages SET
  category        = 'unknown',
  route           = 'review',
  handling        = 'manual_review',
  gate_color      = 'red',
  pricing_allowed = false,
  gate_reasons    = jsonb_build_array($2::text)
WHERE gmail_message_id = $1
RETURNING gmail_message_id, category, route, gate_color, gate_reasons,
          $2::text AS _error, 'Save triage'::text AS _node;
