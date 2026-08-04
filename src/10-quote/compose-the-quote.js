// A letter carrying a price, written for the customer and left where only the owner can send it.
//
// It is composed here and put in the owner's mailbox as a draft, in the customer's own conversation.
// The owner reads it, changes whatever wants changing, and presses send. Nothing here decides that it goes:
// the draft has no way of leaving on its own, which is a stronger guarantee than the one this
// replaced. That one mailed the letter to the owner and read the reply with a pattern -- so a figure
// reached a customer whenever the pattern matched, and "almost right, let me change a word" was
// read as a refusal, because `change` is one of the words that means no.
//
// One thing comes out of this node: the letter the customer would read. Telling the owner that a
// draft is waiting is a separate step in a separate file, and deliberately so -- what is said to the owner
// carries figures and what the firm is unsure of, and a check in this repository refuses to let the
// two be written a few lines apart. Composing both here would put the owner's sentence one mistaken
// variable away from the customer's letter.

const money = (n) => `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

// The breakdown as a person reads it, not as it is stored. Each line already knows what it is, what
// it was worked out from and at what rate, because the arithmetic wrote all three down when it ran.
const readable = (lines) => (lines || []).map((line) => {
  if (line.kind === 'minimum') {
    return `  ${line.label}: minimum charge ${money(line.amount)} applies`;
  }
  // a flat charge for turning up, not a rate on anything: "1 visit at $50-$150" reads as though
  // there were a price per visit and we had chosen one
  if (line.kind === 'on_site') {
    return `  ${line.label}: counted on site, not from an email — they run `
      + `${money(line.rate_low)}-${money(line.rate_high)} ${line.unit}, and are not in the figures above`;
  }
  if (line.kind === 'travel') {
    return `  ${line.label}: ${money(line.low)}${line.low === line.high ? '' : ` to ${money(line.high)}`}`;
  }
  const rate = line.rate_low === line.rate_high
    ? `${money(line.rate_low)}/${line.unit}`
    : `${money(line.rate_low)}-${money(line.rate_high)}/${line.unit}`;
  const waste = line.wastage_pct ? ` (incl. ${line.wastage_pct}% waste)` : '';
  return `  ${line.label}: ${Number(line.quantity).toLocaleString('en-US')} ${line.unit}${waste} at ${rate}`
    + `\n      ${money(line.low)} to ${money(line.high)}`;
}).join('\n');

// Gmail threads on the subject as well as on the thread id, so the reply carries the subject it is
// replying to. Prefixed once and never twice: a conversation five letters deep would otherwise read
// "Re: Re: Re: Re: Laminate".
//
// An empty subject stays empty. Gmail will only attach a draft to a thread whose subject matches,
// so inventing one for a letter that arrived without a subject puts the draft beside the
// conversation instead of inside it -- and the whole point of this is that the customer's own
// conversation is where it waits.
const replyTo = (subject) => {
  const said = String(subject || '').trim();
  if (!said) return '';
  return /^re\s*:/i.test(said) ? said : `Re: ${said}`;
};

return $input.all().map((item, i) => {
  const q = item.json || {};

  if (q.ready_to_write !== true && q.ready_to_write !== 't') {
    throw new Error('there is no offer to write about, or no wording stored for one: '
      + `offer ${q.offer_id || 'unknown'} with total ${q.total_low === null ? 'nothing' : q.total_low}`);
  }

  // No address, no draft. A lead forwarded by a platform with no reply-to leaves nobody to write
  // to, and a draft addressed to an empty string is one somebody sends by accident.
  const who = String(q.contact_email || '').trim();
  if (!who) {
    throw new Error('there is no address to send this quote to: this arrived through a platform '
      + 'that forwarded no reply-to, and a draft with nobody in the To field is not a letter');
  }

  const breakdown = typeof q.breakdown === 'string' ? JSON.parse(q.breakdown) : (q.breakdown || {});
  const range = `${money(q.total_low)} to ${money(q.total_high)}`;
  // the town is stored the way the customer wrote it, lowercased for matching. A letter is not a
  // lookup key.
  const town = q.city ? String(q.city).replace(/\b[a-z]/g, (c) => c.toUpperCase()) : null;
  const job = [q.material_category, q.area_sqft ? `${Number(q.area_sqft).toLocaleString('en-US')} sq ft` : null,
    town].filter(Boolean).join(', ');

  // What the customer would read, and the whole of what the draft contains. No note to the owner
  // wrapped around it any more: it is read inside the owner's own mail client, about to be sent, and
  // anything above it would be one deleted paragraph away from reaching the customer.
  const forTheCustomer = `${q.opening}\n\n${job}\n\n${readable(breakdown.lines)}\n\n`
    + `All in: ${range}.\n\n${q.closing}${q.signature || ''}`;

  return {
    json: {
      gmail_message_id: q.gmail_message_id,
      offer_id: q.offer_id,
      order_id: q.order_id,
      // the draft: the customer's letter, in the customer's conversation
      write_to: who,
      thread_id: q.thread_id,
      subject: replyTo(q.subject),
      body: forTheCustomer,
      the_letter_itself: forTheCustomer,
    },
    pairedItem: { item: i },
  };
});
