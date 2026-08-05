// What the day and the one after it hold, said once, early, before anybody has opened anything.
//
// It goes out every morning whether or not there is anything in it, and the empty morning is the
// one it exists for. A line that only appears when there is news teaches nobody anything by its
// absence; a line that appears every day at six means that a morning without one is a morning when
// something has stopped -- the mail, the desk, the machine -- and it is noticed over the first
// coffee rather than at the end of the week.
//
// Tomorrow as well as today, because a visit at nine in the morning is not something to find out
// about at six on the day. The evening before is when somebody can still move it.
//
// Only what a person does something about is marked. A visit nobody has confirmed to the customer
// is a visit somebody may or may not turn up for, and that is worth a word before the day starts.

const WHERE_THE_WORK_IS = 'America/Chicago';

const clock = (iso) => new Date(iso).toLocaleTimeString('en-US', {
  timeZone: WHERE_THE_WORK_IS, hour: 'numeric', minute: '2-digit',
});

// A calendar day, and it has to arrive as one. Anything else is refused rather than guessed at: an
// instant carries no day without the timezone it was midnight in, and a line that prints the wrong
// Wednesday is worse than a line that does not arrive -- somebody drives on the strength of it.
// Noon rather than midnight so that no timezone can push the day either way.
const longDay = (day) => {
  const said = String(day ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(said)) {
    throw new Error(`the day arrived as ${JSON.stringify(day)} rather than a calendar day; `
      + 'a date column crossing the wire becomes an instant, and the day it belonged to cannot be '
      + 'recovered from one here');
  }
  return new Date(`${said}T12:00:00Z`).toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
  });
};

const line = (v) => {
  const job = [v.material_category,
    v.area_sqft ? `${Number(v.area_sqft).toLocaleString('en-US')} ${v.area_unit || 'sqft'}` : null]
    .filter(Boolean).join(', ');
  const where = [v.town, v.site_street].filter(Boolean).join(' — ');
  const flags = [
    v.customer_told ? null : '⚠️ not confirmed to them',
    v.site_agreed === false ? '⚠️ address was queried' : null,
    v.page_ready ? null : '⚠️ no page to sign yet',
  ].filter(Boolean);
  return `  \`${clock(v.agreed)}\`  ${where || 'no address'}  ·  ${job || 'job not described'}`
    + `${v.booking_code ? `  ·  \`${v.booking_code}\`` : ''}`
    + (flags.length ? `\n       ${flags.join('  ')}` : '');
};

return $input.all().map((item, i) => {
  const q = item.json || {};
  const all = typeof q.visits === 'string' ? JSON.parse(q.visits) : (q.visits || []);
  const today = all.filter((v) => v.when_it_is === 'today');
  const tomorrow = all.filter((v) => v.when_it_is === 'tomorrow');

  const message = [
    `☀️ *${longDay(q.the_day)}*`,
    '',
    today.length ? '*Today*' : '*Today* — nothing booked',
    ...today.map(line),
    '',
    tomorrow.length ? '*Tomorrow*' : '*Tomorrow* — nothing booked',
    ...tomorrow.map(line),
    ...(all.length ? [] : ['', 'This arrives every morning either way, so a morning without it '
      + 'means the desk has stopped rather than that nothing is on.']),
  ].join('\n');

  return { json: { ...q, message, channel: '#going-out' }, pairedItem: { item: i } };
});
