// One short letter to somebody who has gone quiet, in words a person wrote.
//
// It carries no figure and repeats no question. A customer who did not answer is not helped by
// being asked the same thing again in the same words; they are helped by being reminded that the
// desk is still here and by being told it will stop.

return $input.all()
  .filter((item) => (item.json || {}).what_now === 'nudge')
  .map((item, i) => {
    const row = item.json;
    const words = String(row.nudge || '').trim();

    if (!words) {
      throw new Error('no wording is stored for a nudge, and a reminder that says nothing is '
        + 'worse than none: reply_templates is missing the row "nudge"');
    }
    if (!row.reply_to) {
      throw new Error(`order ${row.order_id} has nobody to reply to: no inbound message of theirs `
        + 'is on file, so there is no letter to continue');
    }

    return {
      json: {
        order_id: row.order_id,
        to: row.contact_email,
        reply_to: row.reply_to,
        thread_id: row.thread_id,
        body: words + String(row.signature || ''),
      },
      pairedItem: { item: i },
    };
  });
