-- Until now nothing the system does leaves a record of having spoken, because nothing speaks. The
-- first thing it will say is a question — what the order is still missing — and the rule that
-- matters more than the wording is that it asks once.
--
-- Two emails arriving a minute apart, both without an area, must not produce two identical
-- requests. So asking is an event like any other, and the decision to ask reads the history rather
-- than a flag: has this same question gone out since anything new arrived?
--
-- The words live in a table because they are the owner's words, not the program's. Changing how the
-- firm sounds should not require a deployment, and should not require reading code to find where a
-- sentence is hiding.

BEGIN;

ALTER TABLE order_events DROP CONSTRAINT order_events_kind_known;

ALTER TABLE order_events ADD CONSTRAINT order_events_kind_known CHECK (kind IN (
    'created', 'merged', 'corrected', 'state_change', 'approved', 'rejected', 'asked'));

CREATE TABLE reply_templates (
    id         integer     GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    key        text        NOT NULL UNIQUE,
    body       text        NOT NULL,
    notes      text,
    updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE reply_templates IS
    'What the firm says, in the owner''s words. Placeholders in {braces} are filled from the order; anything else is sent as written.';

INSERT INTO reply_templates (key, body, notes) VALUES
    ('needs_area',
     'Thanks for getting in touch. To price this I need one more thing: roughly how many square feet is the floor? A rough number is fine — I can firm it up on site.',
     'sent when the material is known and the area is not'),
    ('needs_material',
     'Thanks for getting in touch. What are you thinking of putting down — luxury vinyl plank, laminate, engineered wood, sheet vinyl or carpet?',
     'sent when the area is known and the material is not'),
    ('needs_both',
     'Thanks for getting in touch. Two things and I can put a number on it: what are you thinking of putting down, and roughly how many square feet is the floor?',
     'sent when neither the material nor the area is known'),
    ('needs_location',
     'Thanks for getting in touch. Whereabouts is the property? I work in Austin and about thirty miles around it.',
     'sent when the town is not known'),
    ('signature',
     E'\n\nBest,\nthe flooring desk',
     'appended to every reply')
ON CONFLICT (key) DO NOTHING;

COMMIT;
