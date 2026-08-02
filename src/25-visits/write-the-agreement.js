// What goes into the copy of the agreement that is printed for a visit.
//
// The document itself is the owner's, written and formatted by hand; this only says what each
// {{placeholder}} in it becomes. Nothing here composes prose — a change to the wording of the
// agreement is a change to that document and never to this file, which is the whole reason it is a
// document rather than a template in the database.
//
// Everything is read off the job rather than the newest letter, and everything that is not known is
// said as words rather than left blank: a printed page reading "not said yet" is a page somebody
// fills in at the door, and a blank is a page nobody notices is incomplete.
//
// No price appears here at all. The ballpark belongs in what the owner is told; the only figure on
// the page a customer signs is written on it by hand after the floor has been measured.

const WHERE_THE_WORK_IS = 'America/Chicago';

const when = (iso) => {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  const day = at.toLocaleDateString('en-US', {
    timeZone: WHERE_THE_WORK_IS, weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });
  const time = at.toLocaleTimeString('en-US', {
    timeZone: WHERE_THE_WORK_IS, hour: 'numeric', minute: '2-digit',
  }).toLowerCase().replace(/\s/g, '');
  return `${day}, ${time}`;
};

const number = (n) => Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 });

const SPELLED = {
  remove_first: 'the old floor is taken out first',
  over_existing: 'the new floor goes over what is there',
};

// What the visit has to settle, in words a customer reads on the page they sign. The rates for
// these are the owner's business and stay out of it.
const SPELLED_ON_SITE = {
  stairs: 'the stairs',
  subfloor: 'what is under the old floor',
};

return $input.all().map((item, i) => {
  const row = item.json || {};
  const at = when(row.agreed);
  const onSite = Array.isArray(row.on_site_items) ? row.on_site_items : [];

  if (!row.visit_id || !at || !row.template_id) {
    return {
      json: {
        ...row,
        ready_to_prepare: false,
        why_not: !row.template_id
          ? 'there is no agreement template to copy'
          : 'the visit has no readable time',
      },
      pairedItem: { item: i },
    };
  }

  const replacements = {
    customer_email: row.contact_email || 'not established',
    job_number: String(row.order_id),
    booking_code: row.booking_code || 'not established',
    visit_date: at,
    city: row.city || 'not established',
    material: row.material_category || 'not said yet',
    area_discussed: row.area_sqft
      ? `about ${number(row.area_sqft)} ${row.area_unit || 'sqft'}`
      : 'not given yet',
    existing_floor: row.existing_floor_action
      ? (SPELLED[row.existing_floor_action] || row.existing_floor_action)
      : 'to be decided on site',
    settled_on_site: onSite.length
      ? onSite.map((thing) => SPELLED_ON_SITE[thing] || thing).join(', ')
      : 'nothing outstanding — everything was measurable from the email',
  };

  // The job and the date, so a folder of these is readable without opening any of them, and a copy
  // left behind by a visit that moved is obvious beside the one that replaced it.
  const fileName = `Agreement — job ${row.order_id} — ${at.split(',')[1].trim()} ${at.split(',')[2].trim()}`;

  return {
    json: {
      ...row,
      ready_to_prepare: true,
      why_not: null,
      file_name: fileName,
      replacements,
      // what the Docs API is asked to do, one replacement per placeholder, built here so the node
      // carries no knowledge of what the document says
      requests: Object.entries(replacements).map(([key, value]) => ({
        replaceAllText: {
          containsText: { text: `{{${key}}}`, matchCase: true },
          replaceText: String(value),
        },
      })),
    },
    pairedItem: { item: i },
  };
});
