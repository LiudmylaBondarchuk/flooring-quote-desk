-- find-or-create-an-order decides in a single statement, and a single statement is atomic against
-- itself. It is not atomic against a second statement running beside it. Two first messages in one
-- thread, processed at the same moment, both read an empty open_in_thread and both insert: the
-- conversation ends up with two orders, and the facts of it split between them.
--
-- Nothing in the previous shape could prevent that, because orders_thread_idx was only there to
-- make the lookup fast. This says the thing the code was assuming out loud, in the one place that
-- can enforce it while two connections are arguing.
--
-- The loser of that race gets a unique violation and the node retries; on the second attempt the
-- row is committed and visible, so the email attaches to the order the other message opened. A
-- noisy retry is the correct outcome. A quiet second order is not.
--
-- Closed states are excluded on purpose: a thread that was booked, finished or lost may legitimately
-- start new work later, and that new work is a new order.

BEGIN;

CREATE UNIQUE INDEX orders_one_open_per_thread ON orders (thread_id)
    WHERE state NOT IN ('booked', 'done', 'lost');

COMMIT;
