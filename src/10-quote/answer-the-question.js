// A letter that answers what somebody asked, and then asks for what a price would need.
//
// Two sentences a person wrote: the answer, which lives in the services table so that changing what
// the firm says about tile is one edit in one place, and a closing that asks for the parameters.
// Nothing here decides what the firm does or does not install.

const OWNER = 'flooring.demo.austin@gmail.com';

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
  const answer = String(q.answer).trim();
  const closing = String(q.what_next || '').trim();
  const signature = String(q.signature || '');

  // Only a service the firm actually offers is followed by a request for the parameters. Asking a
  // customer for the square footage of a job that was just declined reads as not having listened.
  const body = weDo && closing ? `${answer}\n\n${closing}${signature}` : `${answer}${signature}`;

  return {
    json: {
      gmail_message_id: q.gmail_message_id,
      service_asked_about: q.service_asked_about,
      we_do: weDo,
      to: q.contact_email,
      reply_to: q.gmail_message_id,
      thread_id: q.thread_id,
      asks_for_more: weDo && Boolean(closing),
      body,
    },
    pairedItem: { item: i },
  };
});
