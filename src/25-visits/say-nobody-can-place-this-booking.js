// A booking the desk will not place by itself, said to the owner rather than resolved.
//
// Two ways it happens. An email and a code point at different jobs, and whichever were picked would
// be picked against evidence. Or something was typed into the code field that leads nowhere — a
// slip, or a code for a job that is already closed — and the email would carry it silently, which
// is right until the day somebody has two jobs open.
//
// Nothing is written and nothing is booked. The customer has Google's own confirmation and believes
// they have an appointment, so this is not a thing to sit in a queue: it is somebody's next five
// minutes.

const WHERE_THE_WORK_IS = 'America/Chicago';

const when = (iso) => {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  return `${at.toLocaleDateString('en-US', {
    timeZone: WHERE_THE_WORK_IS, weekday: 'long', month: 'long', day: 'numeric',
  })}, ${at.toLocaleTimeString('en-US', {
    timeZone: WHERE_THE_WORK_IS, hour: 'numeric', minute: '2-digit',
  }).toLowerCase().replace(/\s/g, '')}`;
};

return $input.all().map((item, i) => {
  const row = item.json || {};
  // itemMatching, never all()[i]. A gate stands between this and the booking that produced it, and
  // a gate compacts: one placeable booking followed by an unplaceable one leaves the second at
  // index nought here while it was index one up there. Pairing by position then puts another
  // customer's address and typed code into this alert -- the one shape of mistake that is worse
  // than the mistake being reported.
  const booking = $('Read the booking').itemMatching(i)?.json || {};
  const at = when(booking.starts_at);

  const why = row.matched_by === 'they disagree'
    ? 'the address they booked from and the code they typed point at different jobs'
    : 'the code they typed does not belong to any open job';

  const message = [
    `🙋 *A booking nobody can place — ${at || 'time unreadable'}*`,
    `✉️ ${booking.booked_email || 'no address on the booking'}`,
    '',
    why,
    '',
    `Typed as the code: \`${booking.code_as_typed || 'nothing'}\``,
    `The address matches job: ${row.by_email || 'none'}`,
    `The code matches job: ${row.by_code || 'none'}`,
    '',
    'Nothing has been booked and nothing written. Google has told them they have an appointment,',
    'so this is somebody\'s next five minutes rather than a queue.',
  ].join('\n');

// Which channel this belongs in travels with the message, because one Slack node is fed by
// composers that mean different things: a draft waiting to be sent and a job nobody but the
// owner can price are not the same errand, and a channel chosen at the node could only ever be
// right for one of them. Named by what the owner has to do about it, never by which lane it
// came from -- the lane is this desk's business, and the errand is theirs.
  return { json: { ...row, message, channel: '#needs-a-person' }, pairedItem: { item: i } };
});
