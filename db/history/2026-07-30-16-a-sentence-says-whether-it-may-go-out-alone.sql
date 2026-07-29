-- The desk is about to speak to customers. Which sentences may go out without a person reading
-- them first is a business decision, not a property of the code, and it belongs beside the words
-- rather than inside a workflow.
--
-- Every sentence stored today asks for information and carries no number, no price and no promise.
-- The worst a wrong one can do is ask for something the customer already gave, which costs a little
-- patience. So they all go out alone.
--
-- The first sentence that will not is the one carrying a price. When it is written, this column is
-- how it is held back — an edit, not a deployment, and the machinery for it already ran.

BEGIN;

ALTER TABLE reply_templates ADD COLUMN sends_automatically boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN reply_templates.sends_automatically IS
    'True when this sentence may reach a customer with nobody reading it first. False sends it to the owner instead, marked as not sent.';

UPDATE reply_templates SET sends_automatically = true
 WHERE key IN ('needs_area', 'needs_material', 'needs_both', 'needs_location', 'signature');

COMMIT;
