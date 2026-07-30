WITH upd AS (
UPDATE messages SET
  extracted                 = $1::jsonb,
  category                  = $2,
  matched_rule              = $24,
  out_of_scope              = $25,
  route                     = $3,
  handling                  = $4,
  segment                   = $5,
  is_returning              = $6,
  same_signature            = $16,
  pricing_allowed             = $7,
  auto_blocked              = $28,
  danger                    = $8,
  intent                    = $9,
  geo_zone                  = $10,
  gate_color                = $11,
  gate_reasons              = $12::jsonb,
  missing_fields            = $13::jsonb,
  dropped_fields            = $14::jsonb,
  settled                   = $27::jsonb,
  material_category         = $17,
  assumptions               = $19::jsonb,
  existing_floor_action     = $20,
  fixing_method             = $21,
  old_floor_removal         = $22,
  area_sqft                 = $18::numeric,
  area_status               = $23,
  area_unit                 = $26,
  status                    = CASE WHEN $4 = 'none' THEN 'closed' ELSE 'triaged' END,
  prompt_version            = 'extract-v3',
  extraction_schema_version = 'v3',
  workflow_version          = 'v1.4-hardened'
WHERE gmail_message_id = $15
  RETURNING gmail_message_id
)
SELECT
  $15::text AS gmail_message_id,
  $2::text  AS category,
  $3::text  AS route,
  $4::text  AS handling,
  $11::text AS gate_color,
  (SELECT count(*) FROM upd) > 0 AS saved;
