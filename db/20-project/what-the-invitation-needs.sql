-- Everything a letter inviting somebody to book a visit needs, for the job this email belongs to.
--
-- Only a job that has just reached survey_needed, and only one that has not been invited already:
-- a customer who says "yes" twice, or a router that delivers the same acceptance twice, must not be
-- sent two invitations. visits.state = 'offered' is the mark of an invitation out and unanswered.
--
-- The address is the one on the order. Everything about a booking is matched back to a job by that
-- address or by the code below it, and inviting one address while expecting another to book is how
-- the matching gets an argument with itself.

SELECT m.gmail_message_id,
       o.id                                    AS order_id,
       o.contact_email                         AS write_to,
       o.booking_code,
       o.material_category,
       o.area_sqft,
       o.area_unit,
       o.city,
       (SELECT body FROM reply_templates WHERE key = 'booking_link')             AS link,
       (SELECT body FROM reply_templates WHERE key = 'visit_invitation')         AS opening,
       (SELECT body FROM reply_templates WHERE key = 'visit_invitation_closing') AS closing,
       (SELECT body FROM reply_templates WHERE key = 'signature')                AS signature
  FROM messages m
  JOIN orders o ON o.id = m.order_id
 WHERE m.gmail_message_id = $1::text
   AND o.state = 'survey_needed'
   AND o.contact_email IS NOT NULL
   AND o.booking_code IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM visits v
                    WHERE v.order_id = o.id
                      AND v.state IN ('offered', 'agreed'));
