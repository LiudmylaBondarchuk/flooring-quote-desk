// The line that tells the owner a quote is sitting in the owner's drafts.
//
// It exists because a draft announces itself to nobody. The letter the desk used to send
// arrived in the inbox and was impossible to miss; a draft lies in a folder until somebody
// remembers to look, and a quote nobody remembers is a customer nobody answered.
//
// Written here rather than beside the letter itself, and that separation is the point. This carries
// the figures and whether the gate held the enquiry for a person -- things the customer must never
// read. A check in this repository refuses to let a customer letter be composed in a file that
// reaches for what the owner is told, and composing both in one place would put this sentence one
// mistaken variable away from the draft.
//
// It never carries the letter. The letter lives in exactly one place, which is the draft about to
// be sent: two copies of it would be two things to keep in step.

// The owner's own mailbox, so the link opens in it whichever account the browser happens to be
// showing. Gmail takes an address here as readily as the index, and the index is different on every
// machine. Repeated from three other files, which is three too many already -- it belongs in one
// place and does not live in one yet.
const OWNER = 'flooring.demo.austin@gmail.com';

const money = (n) => `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

return $input.all().map((item, i) => {
  const q = $('What the quote letter needs').itemMatching(i)?.json || {};
  const drafted = $('Compose the quote').itemMatching(i)?.json || {};

  const range = `${money(q.total_low)} to ${money(q.total_high)}`;
  const town = q.city ? String(q.city).replace(/\b[a-z]/g, (c) => c.toUpperCase()) : null;
  const job = [q.material_category, q.area_sqft ? `${Number(q.area_sqft).toLocaleString('en-US')} sq ft` : null,
    town].filter(Boolean).join(', ');

  // Straight into the conversation the draft is sitting in, labelled with what the customer called
  // it. A customer on their twentieth letter has several conversations open and a description of the
  // job -- laminate, four hundred feet, Kyle -- can fit more than one of them. The subject is what
  // tells them apart to a person, and the link means nobody has to tell them apart at all.
  const conversation = q.thread_id
    ? `\n🔗 <https://mail.google.com/mail/u/${OWNER}/#all/${q.thread_id}|`
      + `${String(drafted.subject || '').trim() || 'Open the conversation'}>`
    : '';

  const message = [
    `📝 *A quote is drafted and waiting — ${range}*`,
    `✉️ ${drafted.write_to || q.contact_email || 'no address on file'}`,
    `🧾 ${job || 'job not described'}${conversation}`,
    '',
    q.auto_blocked
      ? 'The gate held this enquiry for a person before anything automatic happened to it. Read the '
        + 'enquiry as well as the letter before you send.'
      : 'It is in your drafts, in their own conversation. Read it, change whatever you want to '
        + 'change, and send it. Nothing goes until you do.',
  ].join('\n');

// Which channel this belongs in travels with the message, because one Slack node is fed by
// composers that mean different things: a draft waiting to be sent and a job nobody but the
// owner can price are not the same errand, and a channel chosen at the node could only ever be
// right for one of them. Named by what the owner has to do about it, never by which lane it
// came from -- the lane is this desk's business, and the errand is theirs.
  return { json: { ...item.json, message, channel: '#drafts' }, pairedItem: { item: i } };
});
