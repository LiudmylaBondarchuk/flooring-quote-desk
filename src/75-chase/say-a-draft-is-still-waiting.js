// The line that says a quote was written and never sent.
//
// A draft announces itself once and then goes as quiet as the customer waiting for it. One sat for
// five days; nothing was broken, there was simply nobody whose job it was to look again.
//
// Twice, and then never. A line that repeats until it is obeyed is a line people mute, and a muted
// channel is the same as no channel. So the second one says plainly that it is the last and that
// the job is being closed as it is written -- not as a threat, but because a job nobody sends a
// price for is not an open job, and leaving it open would be the desk pretending otherwise.
//
// The same channel the draft was announced in, because it is the same errand: read it and send it.

const OWNER = 'flooring.demo.austin@gmail.com';

const money = (n) => `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

const howLong = (hours) => {
  const h = Number(hours) || 0;
  if (h < 48) return `${h} hours`;
  return `${Math.floor(h / 24)} days`;
};

return $input.all().map((row, i) => {
  const q = row.json || {};

  const town = q.city ? String(q.city).replace(/\b[a-z]/g, (c) => c.toUpperCase()) : null;
  const job = [q.material_category,
    q.area_sqft ? `${Number(q.area_sqft).toLocaleString('en-US')} sq ft` : null,
    town].filter(Boolean).join(', ');

  // Straight into the conversation, chosen by address rather than by the u/ index: the index is
  // different on every machine, and written into the path it answers 404 rather than opening the
  // wrong mailbox.
  const conversation = q.thread_id
    ? `\n🔗 <https://mail.google.com/mail/?authuser=${OWNER}#all/${q.thread_id}|Open the conversation>`
    : '';

  const last = q.the_last_time === true || q.the_last_time === 't';

  const message = [
    last
      ? `⏳ *Still not sent — ${money(q.total_low)} to ${money(q.total_high)}*`
      : `⏳ *A quote has been waiting ${howLong(q.hours_waiting)} — ${money(q.total_low)} to ${money(q.total_high)}*`,
    `✉️ ${q.contact_email || 'no address on file'}`,
    `🧾 ${job || 'job not described'}${conversation}`,
    '',
    last
      ? 'This is the second time and the last. The job is closed as of now, so nothing further will '
        + 'be said about it. Send the draft anyway if you want it to go — closing the job does not '
        + 'delete the letter.'
      : 'It is still sitting in your drafts. Send it, or leave it and I will say so once more before '
        + 'closing the job.',
  ].join('\n');

  return { json: { ...q, message, channel: '#drafts' }, pairedItem: { item: i } };
});
