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
// It never carries the letter. The letter lives in exactly one place, which is the draft about to be sent: two copies of it would be two things to keep in step.

const money = (n) => `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

return $input.all().map((item, i) => {
  const q = $('What the quote letter needs').itemMatching(i)?.json || {};
  const drafted = $('Compose the quote').itemMatching(i)?.json || {};

  const range = `${money(q.total_low)} to ${money(q.total_high)}`;
  const town = q.city ? String(q.city).replace(/\b[a-z]/g, (c) => c.toUpperCase()) : null;
  const job = [q.material_category, q.area_sqft ? `${Number(q.area_sqft).toLocaleString('en-US')} sq ft` : null,
    town].filter(Boolean).join(', ');

  const message = [
    `📝 *A quote is drafted and waiting — ${range}*`,
    `✉️ ${drafted.write_to || q.contact_email || 'no address on file'}`,
    `🧾 ${job || 'job not described'}`,
    '',
    q.auto_blocked
      ? 'The gate held this enquiry for a person before anything automatic happened to it. Read the '
        + 'enquiry as well as the letter before you send.'
      : 'It is in your drafts, in their own conversation. Read it, change whatever you want to '
        + 'change, and send it. Nothing goes until you do.',
  ].join('\n');

  return { json: { ...item.json, message }, pairedItem: { item: i } };
});
