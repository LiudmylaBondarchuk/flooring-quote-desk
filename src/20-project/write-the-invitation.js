// The letter that asks somebody to pick a time, with the link and the code they will need.
//
// It goes out at the one moment a customer is most certain and least patient: they have just said
// yes to a price. Everything about visits worked from the moment a booking arrived, and nothing
// ever asked for one -- so a customer who accepted heard nothing at all, which is the worst
// possible moment in the conversation to go quiet.
//
// The code is set out on its own line and nowhere else. It is going to be copied by eye into a form
// on another page, and a code buried mid-sentence is a code half of them will mistype.

const number = (n) => Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 });

const theJob = (row) => {
  const lines = [];
  if (row.material_category) lines.push(`  Floor: ${row.material_category}`);
  if (row.area_sqft) lines.push(`  Area: about ${number(row.area_sqft)} ${row.area_unit || 'sqft'}`);
  if (row.city) lines.push(`  Where: ${row.city}`);
  return lines;
};

return $input.all().map((item, i) => {
  const row = item.json || {};

  // The lookup returns nothing when the job has already been invited or is not waiting for a visit,
  // and n8n hands an empty item along rather than stopping. Saying so beats sending a letter with
  // the word undefined where the link should be.
  if (!row.order_id || !row.write_to || !row.link || !row.booking_code) {
    return {
      json: { ...row, ready_to_send: false,
        why_not: !row.order_id ? 'this job is not waiting for a visit, or has already been asked'
          : !row.link ? 'no booking link is stored'
            : !row.booking_code ? 'this job has no code to give them'
              : 'the job has no address to write to' },
      pairedItem: { item: i },
    };
  }

  const job = theJob(row);
  const body = [
    row.opening,
    '',
    `  ${row.link}`,
    '',
    `  Your code: ${row.booking_code}`,
    ...(job.length ? ['', ...job] : []),
    '',
    row.closing,
    row.signature,
  ].join('\n');

  return {
    json: { ...row, ready_to_send: true, why_not: null,
      subject: 'Booking a time to see the floor', body },
    pairedItem: { item: i },
  };
});
