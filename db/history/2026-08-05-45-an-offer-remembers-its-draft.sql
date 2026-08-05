-- Which Gmail draft an offer is waiting in.
--
-- Until now nothing on this side knew. The draft was created, its id came back, and the id was
-- thrown away -- which was harmless while a job could only ever have one price waiting.
--
-- It cannot stay that way once a price can be replaced. A customer who writes again with a
-- different size gets a new figure, and the letter carrying the old one is still sitting in the
-- owner's drafts with nothing to say it is stale. Two drafts in one conversation, one of them
-- wrong, and the only thing standing between the customer and the wrong number is somebody
-- noticing which is which at the moment they press send.
--
-- With the id here, the letter that has been superseded can be removed rather than explained.

ALTER TABLE offers
  ADD COLUMN IF NOT EXISTS draft_id text;

COMMENT ON COLUMN offers.draft_id IS
  'The Gmail draft this offer is waiting in, so a superseded one can be removed rather than left beside its replacement. Null once sent: sending a draft ends it.';
