-- Three times offered, one of them agreed.
--
-- The boundary decision leaves a job at survey_needed and nothing to do with it. This is what it
-- does next: the desk names three concrete times, the customer replies with a number, and the visit
-- is remembered. By reply and not by a link, because this world is email -- a link needs a page, a
-- login and a customer willing to use them, and the reply is one keystroke.
--
-- The times are stored as they were offered, in the order they were offered, so that "the second
-- one" means something a month later when somebody asks what was agreed. Reconstructing them from a
-- calendar afterwards would answer a different question: what was free then, not what was said.

CREATE TABLE IF NOT EXISTS visits (
    id           integer     GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    order_id     integer     NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
    state        text        NOT NULL DEFAULT 'offered',
    offered      jsonb       NOT NULL,
    offered_in   text        REFERENCES messages (gmail_message_id) ON DELETE SET NULL,
    offered_at   timestamptz NOT NULL DEFAULT now(),
    agreed       timestamptz,
    agreed_in    text        REFERENCES messages (gmail_message_id) ON DELETE SET NULL,
    agreed_at    timestamptz,

    CONSTRAINT visits_state_known CHECK (state IN ('offered', 'agreed', 'lapsed')),
    -- a visit that is agreed has a time, and a time means it is agreed. Neither half is useful
    -- alone: a time nobody agreed to is a guess, and an agreement to nothing is a diary entry.
    CONSTRAINT visits_agreed_has_a_time CHECK ((state = 'agreed') = (agreed IS NOT NULL)),
    CONSTRAINT visits_agreement_is_stamped CHECK ((agreed IS NULL) = (agreed_at IS NULL)),
    CONSTRAINT visits_offered_three CHECK (jsonb_typeof(offered) = 'array'
        AND jsonb_array_length(offered) BETWEEN 1 AND 5)
);

-- One open offer per job. A second set of times sent while the first is unanswered is two diaries
-- for one customer, and whichever they answer the other is still on the books.
CREATE UNIQUE INDEX IF NOT EXISTS visits_one_open_per_order ON visits (order_id)
    WHERE state = 'offered';

COMMENT ON TABLE visits IS
    'Times offered for somebody to come and see the floor, and which of them was agreed. Offered as written, in the order written, so that "the second one" still means something later.';
