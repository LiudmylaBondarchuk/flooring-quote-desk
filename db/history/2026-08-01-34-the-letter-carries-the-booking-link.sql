-- The letter that invites somebody to book, and where the link to do it lives.
--
-- Everything about visits worked from the moment a booking arrived, and nothing ever asked for one.
-- A customer who accepted a price was moved to survey_needed and then heard nothing at all, which
-- is the worst moment in the whole conversation to go quiet: they have just said yes.
--
-- The link is a row in this table and not a constant in a node, so it can be changed without a
-- deploy. Google gives out more than one form of it: the short calendar.app.google/... one from
-- "Copy link" is the shareable form, and the long /calendar/u/0/... one is relative to whichever
-- Google account the reader's browser happens to have first. Sending the second to a customer sends
-- them somewhere that depends on who they are logged in as.

INSERT INTO reply_templates (key, body, sends_automatically, notes) VALUES
  ('booking_link',
   'https://calendar.app.google/joiwY4e7yReLfzyQ6',
   true,
   'the short share link from Copy link, never the /calendar/u/0/ form, which resolves against the reader own Google account. Changing the booking page means changing this row and nothing else.'),
  ('visit_invitation',
   'Good — thank you. The next step is for me to come and see the floor, so the price stops being a range and starts being a number.

Pick whichever time suits you here:',
   true,
   'sent when a customer accepts a ballpark and the order moves to survey_needed'),
  ('visit_invitation_closing',
   'The booking page will ask for a code so I can match the visit to your job. It is above. Nothing else is needed, and it takes about a minute.',
   true,
   'after the link and the code')
ON CONFLICT (key) DO NOTHING;
