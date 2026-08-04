// A letter that answers what somebody asked, and then asks for what a price would need.
//
// Two sentences a person wrote: the answer, which lives in the services table so that changing what
// the firm says about tile is one edit in one place, and a closing that asks for the parameters.
// Nothing here decides what the firm does or does not install.

const OWNER = 'flooring.demo.austin@gmail.com';

// A rate reads as $4 or $4.50, never as $4.5.
const money = (n) => {
  const v = Number(n);
  return `$${v.toLocaleString('en-US', {
    minimumFractionDigits: Number.isInteger(v) ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
};

// What the work costs per square foot, laid out for a person. The numbers come from price_bands
// and the sentence around them from reply_templates; nothing here decides what the firm charges.
//
// A published range is not a quote. It commits nobody, it needs no measurements, and it is the one
// thing somebody wants to know before anything else -- so withholding it until they have answered
// two questions is the pause this desk exists to remove.
const rateBlock = (asked) => {
  const bands = typeof asked.bands === 'string' ? JSON.parse(asked.bands) : asked.bands;
  const preamble = String(asked.rates_preamble || '').trim();
  if (!Array.isArray(bands) || !bands.length || !preamble) return '';
  const lines = bands
    .map((b) => `  ${b.product}: ${money(b.rate_low)}-${money(b.rate_high)} per sq ft`)
    .join('\n');
  return `\n\n${preamble}\n\n${lines}`;
};

return $input.all().map((item, i) => {
  const q = item.json || {};
  const worth = q.worth_answering === true || q.worth_answering === 't';

  if (!worth) {
    throw new Error('there is nothing to answer here: '
      + `asked about ${q.service_asked_about || 'nothing recognised'}, `
      + `${q.answer ? 'with' : 'without'} an answer stored, `
      + `${q.contact_email ? 'with' : 'without'} an address to reply to`);
  }

  const weDo = q.we_do === true || q.we_do === 't';
  // An opening, because every other letter has one and this is the one most likely to be the first
  // thing anybody reads from the firm. Absent from the table, the letter still goes -- a missing
  // greeting is a worse letter, not a broken one, and refusing to answer somebody over it would be
  // the wrong trade.
  const opening = String(q.opening || '').trim();
  const answer = String(q.answer).trim();
  const closing = String(q.what_next || '').trim();
  const signature = String(q.signature || '');

  // Only a service the firm actually offers gets rates and a request for the parameters. Quoting a
  // rate for work that was just declined, or asking for the square footage of it, reads as not
  // having listened -- and the refusal is the whole of what that letter has to say.
  const rates = weDo ? rateBlock(q) : '';
  const said = weDo && closing ? `${answer}${rates}\n\n${closing}` : answer;
  const body = `${opening ? `${opening}\n\n` : ''}${said}${signature}`;

  return {
    json: {
      gmail_message_id: q.gmail_message_id,
      service_asked_about: q.service_asked_about,
      we_do: weDo,
      to: q.contact_email,
      reply_to: q.gmail_message_id,
      thread_id: q.thread_id,
      asks_for_more: weDo && Boolean(closing),
      quoted_a_rate: weDo && rates !== '',
      body,
    },
    pairedItem: { item: i },
  };
});
