-- The booking page this desk sends people to.
--
-- A new schedule, and the short share link for it. The long /calendar/u/0/... form of the same page
-- resolves against whichever Google account the reader's browser has first, so it is not a thing to
-- put in a letter to a stranger.
--
-- A row rather than a constant, so the next move needs an UPDATE and not a deploy.

UPDATE reply_templates
   SET body = 'https://calendar.app.google/CrUEcreHuaL2WSy4A', updated_at = now()
 WHERE key = 'booking_link';
