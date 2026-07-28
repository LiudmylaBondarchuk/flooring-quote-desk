-- What price_bands will accept in its three closed columns, read out of the constraints
-- themselves rather than written down a second time.
--
-- The validator that reads the spreadsheet needs these lists to say "row 7 says sqfeet, and the
-- unit has to be one of sqft, sqyd, each, job". Every other way of giving it that knowledge is a
-- copy: a const in a Code node, a literal in this file, a table seeded to agree with a CHECK.
-- Copies drift, and the first sign of drift here is a sync that refuses a row the database would
-- have taken, or takes one it will not.
--
-- The category spellings come back exactly as the constraint writes them, which is what lets the
-- validator turn a customer-grade "lvp" in the sheet into the LVP the rest of the schema uses.
--
-- COLLATE "C" because a plain ORDER BY sorts by the database's own locale: LVP lands before
-- Laminate on one machine and after it on another, and the answer this query gives should not
-- depend on where it runs.

SELECT jsonb_object_agg(column_name, accepted) AS accepts
  FROM (
        SELECT regexp_replace(c.conname, '^price_bands_|_known$', '', 'g') AS column_name,
               to_jsonb(array_agg(found[1] ORDER BY found[1] COLLATE "C")) AS accepted
          FROM pg_constraint c
          CROSS JOIN LATERAL regexp_matches(pg_get_constraintdef(c.oid), '''([^'']+)''', 'g') AS found
         WHERE c.conrelid = 'price_bands'::regclass
           AND c.contype = 'c'
           AND c.conname LIKE '%\_known'
         GROUP BY 1
       ) per_column;
