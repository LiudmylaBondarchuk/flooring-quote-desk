const accepts = $('What the catalogue accepts').first().json.accepts || {};

const FIELDS = ['category', 'component', 'product', 'unit',
  'rate_low', 'rate_high', 'wastage_pct', 'min_charge', 'notes'];
const REQUIRED = ['category', 'rate_low', 'rate_high'];
const DEFAULTS = { component: 'floor', unit: 'sqft', wastage_pct: 10 };
const FIRST_DATA_ROW = 2;
const FROM_THE_TOOL = ['row_number'];

const text = (raw) => String(raw ?? '').replace(/\s+/g, ' ').trim();
const key = (heading) => text(heading).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

const number = (raw) => {
  const written = text(raw);
  if (written === '') return { given: false, value: null };
  const bare = written.replace(/[$\s]/g, '');
  if (/^-?\d+(\.\d+)?$/.test(bare)) return { given: true, value: Number(bare) };
  if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(bare)) return { given: true, value: Number(bare.replace(/,/g, '')) };
  return { given: true, value: null, unreadable: written };
};

const spelledAs = (accepted, written) => {
  const wanted = text(written).toLowerCase();
  return (accepted || []).find((value) => value.toLowerCase() === wanted) || null;
};

const rows = $input.all().map((item) => item.json);
const refusals = [];
const refuse = (line, why) => refusals.push(line === null ? why : `row ${line}: ${why}`);

const named = rows.map((row) => {
  const renamed = {};
  for (const [heading, value] of Object.entries(row)) renamed[key(heading)] = value;
  return renamed;
});

const filled = named
  .map((row, index) => ({ row, line: Number(row.row_number) || index + FIRST_DATA_ROW }))
  .filter(({ row }) => FIELDS.some((field) => text(row[field]) !== ''));

const headings = new Set(named.flatMap((row) => Object.keys(row)));
const missing = FIELDS.filter((field) => !headings.has(field));

if (rows.length === 0) {
  refuse(null, 'the sheet came back with no rows at all. Nothing is applied, because an empty '
    + 'answer is what a failed read looks like as well as an emptied sheet');
} else if (missing.length > 0) {
  refuse(null, `the sheet has no ${missing.join(', ')} column. Expected headings: ${FIELDS.join(', ')}`);
} else if (filled.length === 0) {
  refuse(null, 'every row in the sheet is blank');
}

const clean = [];
if (refusals.length === 0) {
  const seen = new Map();

  for (const { row, line } of filled) {
    const before = refusals.length;

    for (const field of REQUIRED) {
      if (text(row[field]) === '') refuse(line, `${field} is empty, and it has to be filled in`);
    }

    const category = spelledAs(accepts.category, row.category);
    if (text(row.category) !== '' && category === null) {
      refuse(line, `category says "${text(row.category)}", and the firm installs `
        + `${(accepts.category || []).join(', ')}. Adding a sixth material is a change to the database, not the sheet`);
    }

    const component = text(row.component) === '' ? DEFAULTS.component
      : spelledAs(accepts.component, row.component);
    if (text(row.component) !== '' && component === null) {
      refuse(line, `component says "${text(row.component)}", and it has to be one of `
        + `${(accepts.component || []).join(', ')}`);
    }

    const unit = text(row.unit) === '' ? DEFAULTS.unit : spelledAs(accepts.unit, row.unit);
    if (text(row.unit) !== '' && unit === null) {
      refuse(line, `unit says "${text(row.unit)}", and it has to be one of ${(accepts.unit || []).join(', ')}`);
    }

    const low = number(row.rate_low);
    const high = number(row.rate_high);
    const wastage = number(row.wastage_pct);
    const minimum = number(row.min_charge);

    for (const [field, read] of [['rate_low', low], ['rate_high', high],
      ['wastage_pct', wastage], ['min_charge', minimum]]) {
      if (read.unreadable !== undefined) refuse(line, `${field} says "${read.unreadable}", which is not a number`);
    }

    if (low.value !== null && low.value <= 0) refuse(line, `rate_low is ${low.value}, and a rate has to be above zero`);
    if (high.value !== null && low.value !== null && high.value < low.value) {
      refuse(line, `rate_high (${high.value}) is below rate_low (${low.value})`);
    }
    if (wastage.value !== null && (!Number.isInteger(wastage.value) || wastage.value < 0 || wastage.value > 100)) {
      refuse(line, `wastage_pct is ${wastage.value}, and it has to be a whole number between 0 and 100`);
    }
    if (minimum.value !== null && minimum.value < 0) refuse(line, `min_charge is ${minimum.value}, which is below zero`);
    if (component === 'floor' && !minimum.given) {
      refuse(line, 'min_charge is empty, and every floor rate needs one — it is what a small job is billed');
    }

    const product = text(row.product) || null;
    const together = `${category} / ${component} / ${(product || '').toLowerCase()}`;
    if (seen.has(together)) {
      refuse(line, `this is the same ${category} / ${component}`
        + `${product ? ` / ${product}` : ' with no product'} as row ${seen.get(together)}`);
    } else if (refusals.length === before) {
      seen.set(together, line);
    }

    if (refusals.length !== before) continue;

    clean.push({
      category,
      component,
      product,
      unit,
      rate_low: low.value,
      rate_high: high.value,
      wastage_pct: wastage.given ? wastage.value : DEFAULTS.wastage_pct,
      min_charge: minimum.given ? minimum.value : null,
      notes: text(row.notes) || null,
      sheet_row: line,
    });
  }
}

const sane = refusals.length === 0 && clean.length > 0;

return [{
  json: {
    sane,
    rows_seen: rows.length,
    rows_accepted: sane ? clean.length : 0,
    refusals,
    ignored_columns: [...headings]
      .filter((heading) => heading !== '' && !FIELDS.includes(heading) && !FROM_THE_TOOL.includes(heading))
      .sort(),
    rows: sane ? clean : [],
    said: sane
      ? `${clean.length} row(s) read from the sheet, nothing wrong with any of them`
      : `The price list was not applied. Nothing in the database changed.\n\n${refusals.join('\n')}`,
  },
}];
