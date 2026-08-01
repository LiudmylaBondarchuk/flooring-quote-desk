// The letter that says a booking landed on a job, written a quarter of an hour after it did.
//
// Google has already sent its own confirmation with the time in it. This one says what Google
// cannot: which job this visit is for, what the desk has on it so far, and that the customer can
// correct any of it by replying. Repeating the time as well is deliberate -- it is the one fact
// both letters carry, and it is how a customer knows the two are about the same thing.
//
// The time is rendered in Texas. It was stored as an instant, and an instant printed in the wrong
// place is a wrong time: the same booking read half past eight in the evening to somebody sitting
// in Warsaw and half past one in the afternoon to the person driving to it.
const WHERE_THE_WORK_IS = 'America/Chicago';

const when = (iso) => {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  const day = at.toLocaleDateString('en-US', {
    timeZone: WHERE_THE_WORK_IS, weekday: 'long', month: 'long', day: 'numeric',
  });
  const time = at.toLocaleTimeString('en-US', {
    timeZone: WHERE_THE_WORK_IS, hour: 'numeric', minute: '2-digit',
  }).toLowerCase().replace(/\s/g, '');
  return `${day} at ${time}`;
};

const number = (n) => Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 });

// What the desk has on the job, in the customer's own terms. Only what is actually known: a line
// saying "area: not said yet" tells them nothing and reads as a form they failed to fill in.
const theJob = (row) => {
  const lines = [];
  if (row.material_category) lines.push(`  Floor: ${row.material_category}`);
  if (row.area_sqft) lines.push(`  Area: about ${number(row.area_sqft)} ${row.area_unit || 'sqft'}`);
  if (row.city) lines.push(`  Where: ${row.city}`);
  const onSite = Array.isArray(row.on_site_items) ? row.on_site_items : [];
  if (onSite.length) lines.push(`  To measure on the day: ${onSite.join(', ')}`);
  return lines;
};

return $input.all().map((item, i) => {
  const row = item.json || {};
  const at = when(row.agreed);

  // a visit with no readable time is not something to write a letter about. It cannot happen from
  // the booking lane, which takes the time from Google, and saying so beats sending "undefined".
  if (!at || !row.write_to) {
    return {
      json: { ...row, ready_to_send: false,
        why_not: !at ? 'the visit has no readable time' : 'the job has no address to write to' },
      pairedItem: { item: i },
    };
  }

  const job = theJob(row);
  const body = [
    row.opening,
    '',
    `  ${at}`,
    ...(job.length ? ['', ...job] : []),
    '',
    row.closing,
    row.signature,
  ].join('\n');

  return {
    json: {
      ...row,
      ready_to_send: true,
      why_not: null,
      subject: `Visit booked — ${at}`,
      body,
    },
    pairedItem: { item: i },
  };
});
