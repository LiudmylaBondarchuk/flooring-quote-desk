// The sheet whoever drives out reads before knocking on the door.
//
// It is for the owner and never for the customer. Nothing here is written to be sent: it says what
// was quoted and calls it a ballpark, it names what the visit has to settle, and it lists what to
// bring. A customer reading it would learn what the firm charges itself and what it is unsure of,
// neither of which is theirs to see.
//
// Built from the job rather than from the newest letter, for the same reason everything else here
// is: a customer says "laminate, Kyle TX" one day and "about 400 sq ft" the next, and a sheet made
// from either letter sends somebody out knowing half of it.

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
      json: { ...row, ready_to_write: false, why_not: 'the visit has no readable time' },
      pairedItem: { item: i },
    };
  }

  const job = [
    row.material_category ? `Floor:     ${row.material_category}` : 'Floor:     not said yet',
    row.area_sqft ? `Area:      about ${number(row.area_sqft)} ${row.area_unit || 'sqft'}`
      : 'Area:      not said yet — measure everything',
    row.existing_floor_action
      ? `Existing:  ${SPELLED[row.existing_floor_action] || row.existing_floor_action}`
      : 'Existing:  not established — ask on the day',
    row.fixing_method ? `Fixing:    ${row.fixing_method}` : null,
  ].filter(Boolean);

  // What was quoted, and that it was a ballpark. Somebody standing in the room needs to know what
  // the customer already has in mind before saying a firm number out loud.
  const quoted = ballpark && ballpark.low !== null && ballpark.low !== undefined
    ? [`Quoted:    ${money(ballpark.low)} to ${money(ballpark.high)} — a ballpark from the email,`,
      '           not a commitment. The firm price is yours to give on the day.']
    : ['Quoted:    nothing yet.'];

  const settleHere = onSite
    .map((thing) => {
      const rate = rates[thing];
      const range = rate ? ` — ${money(rate.val_low)} to ${money(rate.val_high)} per ${rate.unit}` : '';
      return `  ${thing}${range}, named to the customer and not counted`;
    });

  const sheet = [
    'JOB SHEET',
    '',
    `Visit:     ${at}`,
    `Where:     ${row.city || 'not established'}${row.zone ? ` (${row.zone} of the service area)` : ''}`,
    `Contact:   ${row.contact_email || 'not established'}`,
    `Job:       ${row.order_id}${row.booking_code ? `, code ${row.booking_code}` : ''}`,
    '',
    ...job,
    '',
    ...quoted,
    ...(settleHere.length ? ['', 'To settle on site:', ...settleHere] : []),
    '',
    'Bring:',
    ...toBring(row, onSite).map((thing) => `  ${thing}`),
    '',
    'Not for the customer. Written when the visit was agreed, from the job as it stood then.',
  ].join('\n');

  return {
    json: {
      ...row,
      ready_to_write: true,
      why_not: null,
      file_name: `job-${row.order_id}-${String(at).replace(/[^A-Za-z0-9]+/g, '-').toLowerCase()}.txt`,
      sheet,
    },
    pairedItem: { item: i },
  };
});
