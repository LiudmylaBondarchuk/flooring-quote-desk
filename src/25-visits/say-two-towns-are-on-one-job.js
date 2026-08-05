// The line that says the town booked from is not the town the price was worked out for.
//
// The booking form is where somebody types an address with the deed in hand, so the agreement takes
// its address from there and is right to. What nothing did was notice when that address is in a
// different town from the one the quote was priced against.
//
// A job quoted for Kyle is quoted with Kyle's travel and Kyle's zone. Booked to an address in
// Dallas it is a van driven three hundred kilometres for a price that never counted the journey --
// and Dallas is outside the area the firm works at all, which is a job that should never have been
// taken rather than one taken cheaply.
//
// It decides nothing. A typo and a different city look the same from here and only one of them
// matters, so both towns are printed as they were written and a person looks. Case and spacing are
// ignored upstream, because "kyle" and "Kyle" are one town written twice and a line about that is
// a line nobody reads twice.

return $input.all().flatMap((row, i) => {
  const q = row.json || {};
  if (q.two_towns !== true && q.two_towns !== 't') return [];

  const where = [q.site_street, q.site_postcode].filter(Boolean).join(', ');

  const message = [
    `📍 *Two towns on one job — ${q.order_id}*`,
    `🧾 priced for *${q.priced_for || 'nowhere on file'}*`,
    `📮 booked from *${q.site_city}*${where ? ` — ${where}` : ''}`,
    '',
    'The price was worked out for the first of those, and the visit is to the second. Nothing has '
      + 'been changed and nothing has been said to the customer. It may be a typo; it may be a job '
      + 'in a town this firm does not cover.',
  ].join('\n');

  return [{ json: { ...q, message, channel: '#needs-a-person' }, pairedItem: { item: i } }];
});
