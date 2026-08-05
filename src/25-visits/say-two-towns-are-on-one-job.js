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
// It decides nothing by itself. A typo and a different city look the same from here and only one of
// them matters, so both towns are printed as they were written and a person answers with a tick or
// a cross. Case and spacing are ignored upstream, because "kyle" and "Kyle" are one town written
// twice and a line about that is a line nobody reads twice.

// Hung off the visit rather than off the address, because the answer has to be filed against
// something and the visit is what gets called off. The two towns themselves are read back from the
// step that compared them, which ran before the visit existed.
return $input.all().flatMap((row, i) => {
  const v = row.json || {};
  const q = $('Remember where the job is').itemMatching(i)?.json || {};
  if (q.two_towns !== true && q.two_towns !== 't') return [];

  const where = [q.site_street, q.site_postcode].filter(Boolean).join(', ');

  const message = [
    `📍 *Two towns on one job — ${q.order_id}*`,
    `🧾 priced for *${q.priced_for || 'nowhere on file'}*`,
    `📮 booked from *${q.site_city}*${where ? ` — ${where}` : ''}`,
    '',
    'The price was worked out for the first of those, and the visit is to the second. Nothing has '
      + 'been said to the customer and nothing will be until you answer here.',
    '',
    '✅ the address is right — confirm the visit to them',
    '❌ it is not — call the visit off and close the job',
  ].join('\n');

  return [{ json: { ...q, visit_id: v.id, message, channel: '#needs-a-person' },
    pairedItem: { item: i } }];
});
