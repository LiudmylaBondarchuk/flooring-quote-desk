// What whoever drives out reads before knocking on the door.
//
// A message rather than a file, and not to the mailbox every customer writes to. Somebody about to
// knock is holding a phone, not opening a drive, and a note that lands among the day's letters is
// competing with the work for attention. This goes to its own channel and stays there.
//
// It is for the owner and never for the customer. It says what was quoted and calls it a ballpark,
// it names what only the visit can settle and what this firm charges for those, and it says what to
// bring. A customer reading it would learn what the firm charges itself and what it is unsure of,
// neither of which is theirs to see.
//
// Built from the job rather than from the newest letter, for the same reason everything else here
// is: a customer says "laminate, Kyle TX" one day and "about 400 sq ft" the next, and a message
// made from either letter alone sends somebody out knowing half of it.

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
  return `${day}, ${time}`;
};

const money = (n) => `$${Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
const number = (n) => Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 });

const SPELLED = {
  remove_first: 'the old floor comes out',
  over_existing: 'laying over what is there',
};

// What to bring, worked out from the job rather than printed the same every time. A list that never
// changes is a list nobody reads by the third visit.
const toBring = (row, onSite) => {
  const bring = ['tape measure', 'moisture meter'];
  if (row.material_category) bring.push(`${row.material_category} samples`);
  if (onSite.includes('subfloor')) bring.push('levelling compound sample', 'straightedge');
  if (onSite.includes('stairs')) bring.push('tread gauge');
  if (row.old_floor_removal === true) bring.push('a look under a corner of the old floor');
  return bring;
};

return $input.all().map((item, i) => {
  const row = item.json || {};
  const at = when(row.agreed);
  const onSite = Array.isArray(row.on_site_items) ? row.on_site_items : [];
  const rates = row.on_site_rates && typeof row.on_site_rates === 'object' ? row.on_site_rates : {};
  const ballpark = row.ballpark && typeof row.ballpark === 'object' ? row.ballpark : null;

  if (!row.visit_id || !at) {
    return {
      json: { ...row, ready_to_tell: false, why_not: 'the visit has no readable time' },
      pairedItem: { item: i },
    };
  }

  // The address the customer typed on the booking form, and the city off the job only when they
  // have not booked yet. A town on its own is not somewhere anybody can drive to, and until this
  // was asked for on the form it was all the desk had.
  const booked = [row.site_street, row.site_city, row.site_postcode].filter(Boolean).join(', ');
  const where = booked
    || `${row.city || 'somewhere not established'}${row.zone ? ` (${row.zone} of the service area)` : ''}`;

  const job = [
    row.material_category || 'floor not said yet',
    row.area_sqft ? `about ${number(row.area_sqft)} ${row.area_unit || 'sqft'}`
      : 'no size given — measure everything',
    row.existing_floor_action
      ? (SPELLED[row.existing_floor_action] || row.existing_floor_action)
      : 'what happens to the old floor is not established',
    row.fixing_method || null,
  ].filter(Boolean).join(', ');

  // What was quoted, and that it was a ballpark. Somebody standing in the room needs to know what
  // the customer already has in mind before saying a firm number out loud. It is here and nowhere
  // near the agreement, which is the customer's and carries only the price agreed at the door.
  const quoted = ballpark && ballpark.low !== null && ballpark.low !== undefined
    ? `${money(ballpark.low)} to ${money(ballpark.high)}`
      + ' — a ballpark, not a commitment. The firm price is yours to give on the day.'
    : 'nothing yet.';

  const settleHere = onSite.map((thing) => {
    const rate = rates[thing];
    const range = rate ? ` — ${money(rate.val_low)} to ${money(rate.val_high)} per ${rate.unit}` : '';
    return `• ${thing}${range} — named to the customer, not counted`;
  });

  // Written to be found rather than read: these arrive one after another in a channel, and until
  // they had a heading and headed sections two of them ran together into one wall of sentences with
  // no visible seam. The first line is the one somebody reads standing up.
  const message = [
    `📋 *Job ${row.order_id} — ${at}*`,
    `📍 ${where}`,
    `✉️ ${row.contact_email || 'no address'}${row.booking_code ? `  ·  code \`${row.booking_code}\`` : ''}`,
    '',
    '*The job*',
    job,
    '',
    '*Quoted by email*',
    quoted,
    ...(settleHere.length ? ['', '*To settle on site*', ...settleHere] : []),
    '',
    '*Bring*',
    toBring(row, onSite).join(', '),
    // The page to sign, from the same message. The two were built apart and knew nothing of each
    // other: a briefing arrived, and the document sat on a drive somewhere to be hunted for.
    ...(row.agreement_url ? ['', `📄 <${row.agreement_url}|The page to sign at the door>`] : []),
  ].join('\n');

  return {
    json: { ...row, ready_to_tell: true, why_not: null, message },
    pairedItem: { item: i },
  };
});
