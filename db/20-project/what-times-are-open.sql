-- The open offer of times on the job this letter belongs to, if there is one, and the letter itself.
--
-- Only 'offered' rows: a visit already agreed is not answered again, and a lapsed one is history.
-- The unique index makes "the open offer" a single row rather than a choice.

SELECT m.gmail_message_id,
       m.order_id,
       coalesce(m.body, '')                    AS body,
       v.id                                    AS visit_id,
       coalesce(v.offered, '[]'::jsonb)        AS offered
  FROM messages m
  LEFT JOIN visits v ON v.order_id = m.order_id AND v.state = 'offered'
 WHERE m.gmail_message_id = $1::text;
