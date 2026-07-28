-- Forget the mail this repository sent to itself.
--
-- The demo mailbox is both the sender and the recipient of every test, so after a few dozen
-- runs the gate sees that address as a customer with a long history: prior_from_contact climbs,
-- weak signals start counting, and a fresh enquiry is classified as a continuation of a
-- conversation that never happened. That is not a bug in the gate, it is the test data
-- behaving exactly as real history would.
--
-- Safe to run as often as testing needs it. It touches nothing that did not come from that one
-- address, so mail from any other sender — including anything kept for a demonstration —
-- survives untouched.
--
-- Run it, read the counts it returns, and expect prior_from_contact to be zero on the next
-- email the mailbox receives.

BEGIN;

WITH mine AS (
  SELECT gmail_message_id FROM messages
   WHERE lower(contact_email) = 'flooring.demo.austin@gmail.com'
),
forgotten_failures AS (
  DELETE FROM failures
   WHERE gmail_message_id IN (SELECT gmail_message_id FROM mine)
  RETURNING 1
),
forgotten_messages AS (
  DELETE FROM messages
   WHERE lower(contact_email) = 'flooring.demo.austin@gmail.com'
  RETURNING 1
)
SELECT
  (SELECT count(*) FROM forgotten_messages)::int AS messages_forgotten,
  (SELECT count(*) FROM forgotten_failures)::int AS failures_forgotten;

COMMIT;
