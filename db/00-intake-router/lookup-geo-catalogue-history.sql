SELECT
  $1::jsonb    AS extracted,
  $2::text     AS gmail_message_id,
  $3::boolean  AS body_empty,
  $4::boolean  AS has_photo,
  $5::text     AS source_text,
  $6::text     AS auto_submitted,
  $7::text     AS precedence,
  $8::boolean  AS list_unsubscribe,
  $11::boolean AS is_outbound,
  $12::boolean AS body_fully_quoted,
  $13::boolean AS needs_sender_extraction,
  (SELECT zone FROM service_area WHERE zip = split_part($1::jsonb->>'zip', '-', 1) LIMIT 1) AS zone_by_zip,
  (SELECT zone FROM service_area
    WHERE lower(city) = lower(btrim(regexp_replace(split_part($1::jsonb->>'city', ',', 1),
                                                   '[[:space:]]+(TX|TEXAS)$', '', 'i')))
    LIMIT 1) AS zone_by_city,
  (SELECT json_agg(DISTINCT category) FROM price_bands WHERE active) AS categories,
  (SELECT json_agg(json_build_object('label', s.label, 'we_do', s.we_do,
                                     'match_words', s.match_words, 'answer', s.answer))
     FROM (SELECT * FROM services ORDER BY priority, id) s) AS services,
  (SELECT count(*) FROM messages m
    WHERE m.thread_id = $9::text AND m.gmail_message_id <> $2::text) AS prior_in_thread,
  (SELECT count(*) FROM messages m
    WHERE lower(m.contact_email) = lower($10::text) AND m.gmail_message_id <> $2::text) AS prior_from_contact,
  (SELECT count(*) FROM messages m
    WHERE lower(m.contact_email) = lower($10::text) AND m.gmail_message_id <> $2::text
      AND m.offer_id IS NOT NULL) AS prior_offers,
  -- Two different questions. "Has this person ever been quoted" is a fair signal that a complaint
  -- is about work we did. "Is there an offer to accept" is about this conversation: a customer
  -- quoted for a bathroom last year is not agreeing to that when they write about a bedroom now.
  (SELECT count(*) FROM messages m
    WHERE m.thread_id = $9::text AND m.gmail_message_id <> $2::text
      AND m.offer_id IS NOT NULL) AS offers_in_thread,
  -- validated history only: material_category / area_sqft are what the gate accepted,
  -- never raw model output, so a hallucination cannot suppress a future quote
  (SELECT json_agg(json_build_object('m', m.material_category, 'a', m.area_sqft, 'st', m.area_status))
     FROM messages m
    WHERE lower(m.contact_email) = lower($10::text)
      AND m.gmail_message_id <> $2::text
      AND m.created_at > now() - interval '30 days'
      AND m.material_category IS NOT NULL
      AND m.area_sqft IS NOT NULL) AS prior_signatures;
