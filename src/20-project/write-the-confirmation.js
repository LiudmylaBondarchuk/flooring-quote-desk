// Two letters at the moment a job is won: one to the customer, one to the owner.
//
// The customer's carries no date and no promise of one, because nothing here knows the diary. It
// says the job is theirs and that a person will be in touch to arrange it. Inventing "we will start
// next week" would be the first lie the desk ever told.
//
// The owner's is the only one in this system that exists purely to be read: a job was won, for
// whom, and for how much.

const OWNER = 'flooring.demo.austin@gmail.com';

const money = (n) => (n === null || n === undefined
  ? 'no figure on file'
  : `$${Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 })}`);

return $input.all().flatMap((item, i) => {
  const won = item.json || {};

  if (won.offer_accepted !== true && won.offer_accepted !== 't') {
    throw new Error(`offer ${won.offer_id || 'unknown'} was not accepted by this statement: `
      + 'something else had already answered it, and writing to the customer as though this reply '
      + 'won the job would be telling them twice');
  }

  const words = String(won.confirmation || '').trim();
  if (!words) {
    throw new Error('no wording is stored for a confirmation, and a customer who has just said yes '
      + 'must not be met with silence: reply_templates is missing the row "booked_confirmation"');
  }

  const range = `${money(won.total_low)} to ${money(won.total_high)}`;
  const job = [won.material_category,
    won.area_sqft ? `${Number(won.area_sqft).toLocaleString('en-US')} sq ft` : null,
    won.city ? String(won.city).replace(/\b[a-z]/g, (c) => c.toUpperCase()) : null,
  ].filter(Boolean).join(', ');

  return [
    {
      json: {
        for_whom: 'customer',
        order_id: won.order_id,
        offer_id: won.offer_id,
        to: won.contact_email,
        reply_to: won.gmail_message_id,
        body: words + String(won.signature || ''),
      },
      pairedItem: { item: i },
    },
    {
      json: {
        for_whom: 'owner',
        order_id: won.order_id,
        offer_id: won.offer_id,
        to: OWNER,
        subject: `Booked — ${won.contact_email || 'a customer'} — ${range}`,
        body: `${won.contact_email || 'A customer'} has accepted.\n\n`
          + `Job:     ${job || 'not described'}\n`
          + `Range:   ${range}\n`
          + `Order:   ${won.order_id}\n\n`
          + 'They have been told it is theirs and that you will be in touch to arrange a time. '
          + 'Nothing here knows the diary, so that part is yours.',
      },
      pairedItem: { item: i },
    },
  ];
});
