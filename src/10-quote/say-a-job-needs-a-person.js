// The line that reaches the owner when a job can be priced by nobody but them.
//
// It exists because this branch reached no one at all. A job held for a person -- a managing agent,
// a commercial property, a letter flagged -- is refused by the pricing quite deliberately. If
// nothing is missing there is also nothing to ask the customer, and if the letter is not a question
// about what the firm does there is nothing to answer either. Every door shut, and the last one
// opened onto nowhere: no letter, no handoff, no line anywhere. The customer described their whole
// job and heard back silence.
//
// That is the opposite of what holding a job is for. A hold means a person decides, and a person
// who is never told cannot.
//
// Only where the job is described in full. A letter that adds nothing to an incomplete job belongs
// in the silence -- the desk has already asked, and asking twice with nothing in between is the one
// thing the asking rule exists to prevent.

return $input.all().flatMap((item, i) => {
  const q = item.json || {};
  const job = $('Gather what a price needs').itemMatching(i)?.json || {};

  const described = job.material_category && Number(job.area_sqft) > 0
    && job.zone && job.zone !== 'out';
  if (!described) return [];

  const size = `${Number(job.area_sqft).toLocaleString('en-US')} sq ft`;
  const what = [job.material_category, size, job.zone].filter(Boolean).join(', ');

  const why = job.segment === 'commercial'
    ? 'a commercial enquiry, which this desk never prices on its own'
    : (q.auto_blocked ? 'an email in this conversation is held for a person' : 'the price was refused');

  const message = [
    '🔒 *A job is described in full and waiting for you*',
    `✉️ ${q.contact_email || 'no address on file'}`,
    `🧾 ${what}`,
    '',
    `Held because ${why}. Nothing is missing, so the desk has nothing left to ask and will not `
      + 'write again on its own.',
  ].join('\n');

// Which channel this belongs in travels with the message, because one Slack node is fed by
// composers that mean different things: a draft waiting to be sent and a job nobody but the
// owner can price are not the same errand, and a channel chosen at the node could only ever be
// right for one of them. Named by what the owner has to do about it, never by which lane it
// came from -- the lane is this desk's business, and the errand is theirs.
  return [{ json: { ...q, order_id: job.order_id, message, channel: '#needs-a-person' },
    pairedItem: { item: i } }];
});
