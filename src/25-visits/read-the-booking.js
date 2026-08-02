// What a Google booking actually says, pulled out of the shape Google stores it in.
//
// Two things are wanted: who booked, and the code they typed. Both are in the event, and both are
// in more than one place, which is the trap.
//
// The email is taken from the attendee list and never from the description. The description is
// prose Google assembles, and it is written in the language of whoever is doing the booking: the
// same booking page produced "Zarezerwowane przez" for one booking and "Booked by" for the next,
// because a setting changed between them. Any rule keyed on those words breaks the day somebody
// books from a different country.
//
// The code survives that, because the label is ours: "Order code" is what the booking form was
// told to call the question, so it is the same string in every language Google renders around it.

const TAGS = /<br\s*\/?>|<\/?[a-z][^>]*>/gi;

const plain = (html) => String(html || '')
  .replace(TAGS, '\n')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&nbsp;/g, ' ').replace(/&#39;/g, "'").replace(/&quot;/g, '"');

// the answer is the first non-empty line after the label, which is how Google lays every one of
// them out -- label, newline, answer
const answerTo = (description, label) => {
  const lines = plain(description).split('\n').map((line) => line.trim());
  const at = lines.findIndex((line) => line.toLowerCase() === label.toLowerCase());
  if (at === -1) return null;
  const said = lines.slice(at + 1).find((line) => line !== '');
  return said || null;
};

// Where the work is, asked on the booking form rather than read out of a letter. A customer writes
// "Kyle TX" in an email and means one of several places; here they type it with the deed in front
// of them, and the answer is theirs rather than something extracted from prose.
//
// Three questions rather than one, because somebody given a single box writes "123 Oak St" and
// stops -- and a street with no town is not somewhere anybody can drive to. The postcode earns its
// place separately: the service area is kept by postcode as well as by name, so this is the one
// form of the address the desk can check rather than believe.
//
// Labels are ours, so they survive whatever language Google renders the rest of the page in --
// the same reason the code can be read from here and the guest's email cannot.
const oneLine = (said) => (said ? String(said).replace(/\s+/g, ' ').trim() : null) || null;

// A code is worth nothing unless it is one we could have issued. Accepting anything typed lets a
// stray word match nothing slowly instead of nothing quickly, and puts junk in the logs.
//
// Five letters then two digits, with no separator in the issued form -- but people type what looks
// right to them, so spaces, hyphens and dots are taken out before the shape is checked. Somebody
// writing "kqmnp 47" has done nothing wrong and should not lose their booking over it.
const CODE = /^[ABCDEFGHJKMNPQRSTUVWXYZ]{5}[23456789]{2}$/;
const tidy = (typed) => String(typed || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

return $input.all().map((item, i) => {
  const event = item.json || {};
  const organiser = String(event.organizer?.email || '').toLowerCase();
  const attendees = Array.isArray(event.attendees) ? event.attendees : [];

  // the one who is not us. An appointment schedule puts the desk on every booking as organiser,
  // so the guest is whoever is left.
  const guest = attendees
    .map((a) => String(a.email || '').toLowerCase())
    .find((email) => email && email !== organiser) || null;

  const typed = answerTo(event.description, 'Order code');
  const cleaned = tidy(typed);
  const code = CODE.test(cleaned) ? cleaned : null;

  return {
    json: {
      event_id: event.id || null,
      booked_email: guest,
      booking_code: code,
      code_as_typed: typed,
      site_street: oneLine(answerTo(event.description, 'Street address')),
      site_city: oneLine(answerTo(event.description, 'City')),
      site_postcode: oneLine(answerTo(event.description, 'ZIP code')),
      starts_at: event.start?.dateTime || null,
      time_zone: event.start?.timeZone || null,
      summary: event.summary || null,
      // nothing to look a job up by at all. Said here rather than discovered by two queries that
      // both return nothing.
      nothing_to_go_on: !guest && !code,
    },
    pairedItem: { item: i },
  };
});
