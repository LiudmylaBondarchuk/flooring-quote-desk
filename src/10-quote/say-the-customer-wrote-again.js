// The line for a customer who has written again while their price is still sitting unsent.
//
// Nothing was written this time, and that is the point. The arithmetic came to the same figures it
// came to before, so the letter already drafted is still the right letter -- a second one beside it
// would be two prices in one conversation, and the owner would have to work out which of two
// identical drafts to send.
//
// It is the strongest signal this desk produces. Somebody who writes twice about the same job is
// not going cold; they are waiting. The price is already written, and the only thing between them
// and it is a click nobody has made.
//
// A different figure is not this case: the waiting letter is then wrong, is removed, and a new one
// takes its place.

const money = (n) => `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

const OWNER = 'flooring.demo.austin@gmail.com';

return $input.all().map((item, i) => {
  const q = item.json || {};
  const job = $('Gather what a price needs').itemMatching(i)?.json || {};

  const town = job.city ? String(job.city).replace(/\b[a-z]/g, (c) => c.toUpperCase()) : null;
  const what = [job.material_category,
    job.area_sqft ? `${Number(job.area_sqft).toLocaleString('en-US')} sq ft` : null,
    town].filter(Boolean).join(', ');

  const thread = $('Accept handoff').itemMatching(i)?.json?.thread_id;
  const conversation = thread
    ? `\n🔗 <https://mail.google.com/mail/?authuser=${OWNER}#all/${thread}|Open the conversation>`
    : '';

  const message = [
    `📣 *They have written again — the price is still in your drafts*`,
    `💷 ${money(q.waiting_low)} to ${money(q.waiting_high)}`,
    `🧾 ${what || 'job not described'}${conversation}`,
    '',
    'The figures have not changed, so nothing new was written and there is still one letter to '
      + 'send. Somebody writing twice about the same job is waiting for it.',
  ].join('\n');

  return { json: { ...q, message, channel: '#drafts' }, pairedItem: { item: i } };
});
