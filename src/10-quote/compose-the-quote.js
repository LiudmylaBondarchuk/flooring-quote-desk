// A letter carrying a price, and the one address it is allowed to reach.
//
// Every other letter in this system decides its destination from the stored wording. This one does
// not, and that is the point: a figure must not be one edit in a table away from leaving unread. It
// goes to the owner, always, until there is an approval to authorise anything else.
const OWNER = 'flooring.demo.austin@gmail.com';

const money = (n) => `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

// The breakdown as a person reads it, not as it is stored. Each line already knows what it is, what
// it was worked out from and at what rate, because the arithmetic wrote all three down when it ran.
const readable = (lines) => (lines || []).map((line) => {
  if (line.kind === 'minimum') {
    return `  ${line.label}: minimum charge ${money(line.amount)} applies`;
  }
  const rate = line.rate_low === line.rate_high
    ? `${money(line.rate_low)}/${line.unit}`
    : `${money(line.rate_low)}-${money(line.rate_high)}/${line.unit}`;
  const waste = line.wastage_pct ? ` (incl. ${line.wastage_pct}% waste)` : '';
  return `  ${line.label}: ${Number(line.quantity).toLocaleString('en-US')} ${line.unit}${waste} at ${rate}`
    + `\n      ${money(line.low)} to ${money(line.high)}`;
}).join('\n');

return $input.all().map((item, i) => {
  const q = item.json || {};

  if (q.ready_to_write !== true && q.ready_to_write !== 't') {
    throw new Error('there is no offer to write about, or no wording stored for one: '
      + `offer ${q.offer_id || 'unknown'} with total ${q.total_low === null ? 'nothing' : q.total_low}`);
  }

  const breakdown = typeof q.breakdown === 'string' ? JSON.parse(q.breakdown) : (q.breakdown || {});
  const range = `${money(q.total_low)} to ${money(q.total_high)}`;
  const who = q.contact_email || 'a customer with no address on file';
  // the town is stored the way the customer wrote it, lowercased for matching. A letter is not a
  // lookup key.
  const town = q.city ? String(q.city).replace(/\b[a-z]/g, (c) => c.toUpperCase()) : null;
  const job = [q.material_category, q.area_sqft ? `${Number(q.area_sqft).toLocaleString('en-US')} sq ft` : null,
    town].filter(Boolean).join(', ');

  // What the owner reads: the letter as the customer would receive it, and above it the few facts
  // she needs to decide -- who it is for, what the job is, and where the figures came from.
  const forTheCustomer = `${q.opening}\n\n${job}\n\n${readable(breakdown.lines)}\n\n`
    + `All in: ${range}.\n\n${q.closing}${q.signature || ''}`;

  const body = `This quote is ready and has not been sent. Nothing carrying a figure leaves without you.\n\n`
    + `For:     ${who}\n`
    + `Job:     ${job || 'not described'}\n`
    + `Range:   ${range}\n`
    + `Priced by: ${q.pricing_version || 'unknown version'}\n`
    + `${q.auto_blocked ? '\nThe gate held this email for a person before anything automatic: read it before you send.\n' : ''}`
    + `\n--- the letter as it stands ---\n\n${forTheCustomer}`;

  return {
    json: {
      gmail_message_id: q.gmail_message_id,
      offer_id: q.offer_id,
      order_id: q.order_id,
      to: OWNER,
      reaches_the_customer: false,
      for_whom: who,
      subject: `Quote ready for ${who} — ${range}`,
      body,
      the_letter_itself: forTheCustomer,
    },
    pairedItem: { item: i },
  };
});
