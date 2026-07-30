// Whether this letter is the owner saying yes, and what goes out if it is.
//
// Every letter the desk sends to itself comes back through here, so most of what arrives is the
// desk reading its own words. Two things have to hold before anything reaches a customer: an offer
// is waiting in this thread, and somebody typed an assent into this particular message.
//
// The text examined is the body with quoted history already stripped by the router. That matters
// more here than anywhere else: the letter she is replying to contains the whole quote underneath,
// and looking at the raw message would find the desk's own words and read them as her answer.

const YES = /^(?:\s*(?:yes|yep|yeah|ok|okay|sure|approved?|confirmed?)\b[\s.!,]*)+$/i;
const SEND = /\b(?:send it|send that|send them|go ahead|fire away|ship it|send to (?:the )?(?:customer|client)|looks good,? send|approved,? send)\b/i;

// A refusal is not silence. Saying so is not this branch's job, but reading it as a yes would be
// the worst thing this file could do, so it is named and stopped here.
const NO = /\b(?:no|not yet|hold(?: off| on)?|don'?t send|do not send|wait|stop|cancel|change|amend|fix)\b/i;

return $input.all().map((item, i) => {
  const answer = item.json || {};
  const said = String(answer.said || '').trim();
  const waiting = answer.an_offer_is_waiting === true || answer.an_offer_is_waiting === 't';

  const assented = waiting && !NO.test(said) && (YES.test(said) || SEND.test(said));

  return {
    json: {
      gmail_message_id: answer.gmail_message_id,
      offer_id: answer.offer_id,
      order_id: answer.order_id,
      an_offer_is_waiting: waiting,
      // what was actually read, so a letter that went nowhere can be explained without guessing
      said: said.slice(0, 200),
      approved: assented,
      refused: waiting && NO.test(said),
      to: answer.contact_email,
      reply_to: answer.reply_to,
      thread_id: answer.customer_thread_id,
      body: answer.letter_text,
    },
    pairedItem: { item: i },
  };
});
