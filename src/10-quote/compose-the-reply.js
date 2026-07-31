// Where a letter goes when nobody may read it first. The same address the rest of the system
// writes to, and the only address in this file that is not the customer's.
const OWNER = 'flooring.demo.austin@gmail.com';

// A rate reads as $4 or $4.50; a total reads as $5,600 and never as $5600.
const money = (n) => {
  const v = Number(n);
  return `$${v.toLocaleString('en-US', {
    minimumFractionDigits: Number.isInteger(v) ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
};

// What the job costs per square foot, as a person reads it. The numbers come from price_bands and
// the sentence around them from reply_templates; this only lays them out. A range is a published
// rate, not a quote, so it can be said before anything else is known.
const rateBlock = (asked) => {
  const bands = typeof asked.bands === 'string' ? JSON.parse(asked.bands) : asked.bands;
  const preamble = String(asked.rates_preamble || '').trim();
  if (!Array.isArray(bands) || !bands.length || !preamble) return '';

  const lines = bands
    .map((b) => `  ${b.product}: ${money(b.rate_low)}-${money(b.rate_high)} per sq ft`)
    .join('\n');

  // A total only when the area is real and the job is one the firm would take. A quantity is never
  // invented, and a figure shown to somebody outside the area is an invitation followed by a
  // refusal.
  const area = Number(asked.area_sqft);
  const worth = asked.worth_illustrating === true || asked.worth_illustrating === 't';
  const totals = (area > 0 && worth && bands.length)
    ? `\n\nFor ${area.toLocaleString('en-US')} sq ft that comes to roughly `
      + `${money(Math.round(area * Math.min(...bands.map((b) => Number(b.rate_low)))))} to `
      + `${money(Math.round(area * Math.max(...bands.map((b) => Number(b.rate_high)))))}.`
    : '';

  return `${preamble}\n\n${lines}${totals}\n\n`;
};

const composeOne = (asked) => {
  // Joining strings, nothing else. Every sentence here was written by a person and is stored in
  // reply_templates, so changing how the firm sounds is an edit in the database rather than a
  // deployment -- and nothing in this file decides what the firm says.
  const signature = String(asked.signature || '');

  // A refusal beats a number, and it beats a question. Somebody who wrote "Dallas" has told us
  // where they are; asking them again is worse than saying no, and quoting them a rate is worse
  // still -- it is an invitation to a job that will then be turned down.
  const outOfArea = asked.out_of_area === true || asked.out_of_area === 't';
  const refusal = String(asked.out_of_area_words || '').trim();
  const body = outOfArea ? refusal : String(asked.body || '').trim();

  if (!body) {
    throw new Error(outOfArea
      ? 'no wording is stored for a property outside the service area, and asking somebody in '
        + 'Dallas where they are is worse than saying nothing: reply_templates is missing '
        + '"out_of_area"'
      : `no template is stored for ${asked.template_key || 'this combination'} -- `
        + 'reply_templates is missing a row, and sending an empty letter is worse than sending none');
  }

  // A lead forwarded by a platform with no reply-to leaves no address to answer. The router already
  // says so through needs_sender_extraction, and a letter with nobody in the To field is not a
  // letter. Refusing here sends it to the error lane, where a person can find the address; sending
  // it would fail somewhere less visible, or worse, reach the platform instead of the customer.
  const to = String(asked.contact_email || '').trim();
  if (!to) {
    throw new Error('there is no address to answer: this arrived through a platform that forwarded '
      + 'no reply-to, and the customer cannot be reached without one');
  }

  // Where it goes is the stored sentence's decision, not this file's. A sentence that may not go
  // out alone still gets written -- it goes to the owner, marked as not sent, so she can read it
  // and decide. Nothing is silently dropped and nothing reaches a customer unread.
  const alone = asked.may_go_alone === true || asked.may_go_alone === 't';

  // The customer's copy is a reply, so the subject and the thread are Gmail's to continue and not
  // ours to invent -- one message id is the whole of it. Only the owner's copy needs a subject,
  // because it starts a new letter, and it says what it is at a glance.
  return {
    gmail_message_id: asked.gmail_message_id,
    order_id: asked.order_id,
    asking_for: asked.asking_for,
    to: alone ? to : OWNER,
    reaches_the_customer: alone,
    thread_id: alone ? asked.thread_id : null,
    subject: alone ? null : `Not sent -- a question for ${to}`,
    out_of_area: outOfArea,
    body: alone ? (outOfArea ? body : rateBlock(asked) + body) + signature
      : `This was composed for ${to} and not sent, because the wording it uses is marked as `
        + `needing a person first.\n\nAsking for: ${asked.asking_for}\n\n---\n\n`
        + `${outOfArea ? body : rateBlock(asked) + body}${signature}`,
  };
};

// One letter per enquiry. A poll that finds two customers hands this node both at once, and the
// first version of it answered whichever came first and dropped the other -- silently, with their
// message already marked as handled.
return $input.all().map((item, i) => ({
  json: composeOne(item.json || {}),
  pairedItem: { item: i },
}));
