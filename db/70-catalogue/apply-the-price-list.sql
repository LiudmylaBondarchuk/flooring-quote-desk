-- Copy a spreadsheet the validator has already agreed with into price_bands, as one statement.
--
-- One statement is the whole safety argument. Postgres either runs all of this or none of it, so
-- there is no state in which half the price list is this month's and half is last month's, and no
-- ordering in which a failure halfway through leaves the catalogue describing a business that
-- does not exist. Every branch below is a CTE for that reason and no other.
--
-- Nothing here deletes. A row that has left the sheet is set inactive, keeps its id, and keeps
-- every event and quote that ever pointed at it. Coming back is then an ordinary edit rather than
-- a recovery: put the row back in the sheet and the next sync switches it on again.
--
-- The count(*) > 0 guards are the second copy of a rule the validator already enforces. They stay
-- because they answer a different question: the validator asks whether the sheet is sensible, and
-- these ask whether this statement is allowed to empty a catalogue on the strength of an empty
-- argument, whatever ran before it and whatever anyone rewires later.

WITH incoming AS (
    SELECT sheet ->> 'category'                    AS category,
           sheet ->> 'component'                   AS component,
           nullif(sheet ->> 'product', '')         AS product,
           sheet ->> 'unit'                        AS unit,
           (sheet ->> 'rate_low')::numeric(10, 2)  AS rate_low,
           (sheet ->> 'rate_high')::numeric(10, 2) AS rate_high,
           (sheet ->> 'wastage_pct')::integer      AS wastage_pct,
           (sheet ->> 'min_charge')::numeric(10, 2) AS min_charge,
           nullif(sheet ->> 'notes', '')           AS notes
      FROM jsonb_array_elements($1::jsonb) AS sheet
),
was AS (
    SELECT id, category, component, product, unit, rate_low, rate_high,
           wastage_pct, min_charge, notes, active
      FROM price_bands
),
upserted AS (
    INSERT INTO price_bands (category, component, product, unit, rate_low, rate_high,
                             wastage_pct, min_charge, notes, active, updated_at)
    SELECT category, component, product, unit, rate_low, rate_high,
           wastage_pct, min_charge, notes, true, now()
      FROM incoming
     WHERE (SELECT count(*) FROM incoming) > 0
    ON CONFLICT (category, component, coalesce(product, ''))
    DO UPDATE SET unit        = excluded.unit,
                  rate_low    = excluded.rate_low,
                  rate_high   = excluded.rate_high,
                  wastage_pct = excluded.wastage_pct,
                  min_charge  = excluded.min_charge,
                  notes       = excluded.notes,
                  active      = true,
                  updated_at  = now()
     WHERE (price_bands.unit, price_bands.rate_low, price_bands.rate_high, price_bands.wastage_pct,
            price_bands.min_charge, price_bands.notes, price_bands.active)
        IS DISTINCT FROM
           (excluded.unit, excluded.rate_low, excluded.rate_high, excluded.wastage_pct,
            excluded.min_charge, excluded.notes, true)
    RETURNING id, category, component, product, unit, rate_low, rate_high,
              wastage_pct, min_charge, notes, active, (xmax = 0) AS was_added
),
touched AS (
    SELECT *, category || ' / ' || component || ' / ' || coalesce(product, '(no product)') AS band_key
      FROM upserted
),
retired AS (
    UPDATE price_bands p
       SET active = false, updated_at = now()
     WHERE p.active
       AND (SELECT count(*) FROM incoming) > 0
       AND NOT EXISTS (
           SELECT 1 FROM incoming i
            WHERE i.category = p.category
              AND i.component = p.component
              AND coalesce(i.product, '') = coalesce(p.product, ''))
    RETURNING id, category || ' / ' || component || ' / ' || coalesce(product, '(no product)') AS band_key
),
differences AS (
    SELECT t.id, t.band_key, each.field, each.old_value, each.new_value
      FROM touched t
      JOIN was b ON b.id = t.id
      CROSS JOIN LATERAL (VALUES
          ('unit',        b.unit,               t.unit),
          ('rate_low',    b.rate_low::text,     t.rate_low::text),
          ('rate_high',   b.rate_high::text,    t.rate_high::text),
          ('wastage_pct', b.wastage_pct::text,  t.wastage_pct::text),
          ('min_charge',  b.min_charge::text,   t.min_charge::text),
          ('notes',       b.notes,              t.notes),
          ('active',      b.active::text,       t.active::text)
      ) AS each(field, old_value, new_value)
     WHERE each.old_value IS DISTINCT FROM each.new_value
),
noted_new AS (
    INSERT INTO price_band_events (price_band_id, band_key, kind, field, old_value, new_value)
    SELECT id, band_key, 'added', NULL, NULL,
           rate_low::text || '-' || rate_high::text || ' per ' || unit
      FROM touched WHERE was_added
    RETURNING 1
),
noted_changed AS (
    INSERT INTO price_band_events (price_band_id, band_key, kind, field, old_value, new_value)
    SELECT id, band_key,
           CASE WHEN field = 'active' THEN 'reactivated' ELSE 'changed' END,
           field, old_value, new_value
      FROM differences
    RETURNING 1
),
noted_retired AS (
    INSERT INTO price_band_events (price_band_id, band_key, kind, field, old_value, new_value)
    SELECT id, band_key, 'deactivated', 'active', 'true', 'false' FROM retired
    RETURNING 1
)
SELECT (SELECT count(*) FROM incoming)::int                                    AS rows_in_sheet,
       (SELECT count(*) FROM touched WHERE was_added)::int                     AS added,
       (SELECT count(DISTINCT id) FROM differences WHERE field <> 'active')::int AS changed,
       (SELECT count(*) FROM differences WHERE field = 'active')::int          AS reactivated,
       (SELECT count(*) FROM retired)::int                                     AS deactivated,
       (SELECT count(*) FROM noted_new)::int
     + (SELECT count(*) FROM noted_changed)::int
     + (SELECT count(*) FROM noted_retired)::int                               AS events_written,
       -- counted rather than queried: every CTE here reads the snapshot this statement began
       -- with, so asking price_bands how many rows are active would answer for the catalogue
       -- as it was before the first word of this statement ran.
       ((SELECT count(*) FROM was WHERE active)
      + (SELECT count(*) FROM touched WHERE was_added)
      + (SELECT count(*) FROM differences WHERE field = 'active')
      - (SELECT count(*) FROM retired))::int                                   AS active_after;
