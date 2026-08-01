const PRICING_VERSION = 'quote-v1';
const CURRENCY = 'USD';
const PRICED_UNIT = 'sqft';
const RATE_BASIS = 'rates are this firm\'s own price list as it stood when the quote was made, and the rates used are written into this breakdown';

const LINE_KINDS = { floor: 'floor', removal: 'removal', minimum: 'minimum', travel: 'travel' };

const REFUSALS = [
  ['pricing_not_allowed', (f) => f.row.pricing_allowed !== true],
  ['not_green',           (f) => f.row.gate_color !== 'green'],
  ['commercial',          (f) => f.row.segment === 'commercial'],
  ['no_material',         (f) => f.material === null],
  ['no_price_band',       (f) => f.material !== null && f.bands.length === 0],
  ['no_area',             (f) => f.area === null],
  ['area_not_usable',     (f) => f.row.area_comparable !== true],
  ['no_removal_rate',     (f) => f.removal && f.removalRate === null],
];

// Math.round(n * 100) reads the half-cent off a binary float, and 10.075 * 100 is 1007.4999...,
// so the cent goes down when it should go up. Rounding through the decimal exponent asks
// JavaScript for the shortest decimal that is this float, and rounds that instead.
const money = (n) => Number(`${Math.round(Number(`${n}e2`))}e-2`);

const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const positive = (v) => {
  const n = num(v);
  return n !== null && n > 0 ? n : null;
};

const asBand = (b) => {
  if (!b || typeof b !== 'object') return null;
  if (String(b.unit) !== PRICED_UNIT) return null;
  const low = positive(b.rate_low);
  const high = positive(b.rate_high);
  const wastage = num(b.wastage_pct);
  const minCharge = b.min_charge === null || b.min_charge === undefined ? 0 : num(b.min_charge);
  if (low === null || high === null || high < low) return null;
  if (wastage === null || wastage < 0 || wastage > 100) return null;
  if (minCharge === null || minCharge < 0) return null;
  const label = b.product === null || b.product === undefined || b.product === ''
    ? String(b.category ?? '') : String(b.product);
  return { label, low, high, wastage, minCharge };
};

const asRate = (r) => {
  if (!r || typeof r !== 'object') return null;
  const low = positive(r.val_low);
  const high = positive(r.val_high);
  if (low === null || high === null || high < low) return null;
  return { low, high };
};

const priceOne = (row) => {
  const material = row.material_category === null || row.material_category === undefined
    || row.material_category === '' ? null : String(row.material_category);
  const area = positive(row.area_sqft);
  const bands = (Array.isArray(row.bands) ? row.bands : []).map(asBand).filter((b) => b !== null);
  const removal = row.old_floor_removal === true;
  const rules = row.rules && typeof row.rules === 'object' ? row.rules : {};
  const removalRate = removal ? asRate(rules.old_floor_removal) : null;

  // Georgetown, San Marcos, Wimberley and the rest are inside what this firm covers and outside
  // what the rates already pay for -- core towns have the travel inside the rate, edge ones do not.
  // Until now `edge` produced the sentence "travel fee applies" and never became money, so the
  // quote was short by the drive on every job that had one.
  const travelRate = row.zone === 'edge' ? asRate(rules.travel_fee) : null;

  const facts = { row, material, area, bands, removal, removalRate };
  const refusals = REFUSALS.filter(([, applies]) => applies(facts)).map(([code]) => code);

  const stamped = {
    gmail_message_id: row.gmail_message_id === undefined ? null : row.gmail_message_id,
    pricing_version: PRICING_VERSION,
    currency: CURRENCY,
  };

  if (refusals.length) {
    return {
      ...stamped,
      priceable: false,
      refusals,
      subtotal_low: null,
      subtotal_high: null,
      total_low: null,
      total_high: null,
      breakdown: null,
    };
  }

  const removalLow = removalRate ? money(area * removalRate.low) : 0;
  const removalHigh = removalRate ? money(area * removalRate.high) : 0;
  const removalLines = removalRate ? [{
    kind: LINE_KINDS.removal,
    label: 'old floor removal and disposal',
    source: 'pricing_rules.old_floor_removal',
    unit: PRICED_UNIT,
    quantity: money(area),
    rate_low: removalRate.low,
    rate_high: removalRate.high,
    low: removalLow,
    high: removalHigh,
  }] : [];

  const travelLow = travelRate ? travelRate.low : 0;
  const travelHigh = travelRate ? travelRate.high : 0;
  const travelLines = travelRate ? [{
    kind: LINE_KINDS.travel,
    label: 'travel to the edge of the service area',
    source: 'pricing_rules.travel_fee',
    unit: 'visit',
    quantity: 1,
    rate_low: travelRate.low,
    rate_high: travelRate.high,
    low: travelLow,
    high: travelHigh,
  }] : [];

  const floorLines = [];
  const minimumLines = [];
  const priced = bands.map((b) => {
    // square feet rounded to cents is not a unit of anything. Rounding it here and then
    // multiplying by a rate loses precision before the only place it means money.
    const quantity = area * (1 + b.wastage / 100);
    const floorLow = money(quantity * b.low);
    const floorHigh = money(quantity * b.high);
    floorLines.push({
      kind: LINE_KINDS.floor,
      label: b.label,
      source: 'price_bands',
      unit: PRICED_UNIT,
      quantity: money(quantity),
      wastage_pct: b.wastage,
      rate_low: b.low,
      rate_high: b.high,
      low: floorLow,
      high: floorHigh,
    });

    const subLow = money(floorLow + removalLow);
    const subHigh = money(floorHigh + removalHigh);
    // after the minimum, not inside it: the minimum charge is what the floor work is worth turning
    // up for, and the drive is not floor work. Folding travel in would let a big enough job swallow
    // it and a small one charge it twice over.
    const totLow = money(Math.max(subLow, b.minCharge) + travelLow);
    const totHigh = money(Math.max(subHigh, b.minCharge) + travelHigh);
    if (totLow - travelLow > subLow || totHigh - travelHigh > subHigh) {
      minimumLines.push({
        kind: LINE_KINDS.minimum,
        label: b.label,
        source: 'price_bands.min_charge',
        amount: b.minCharge,
        applied_to_low: totLow - travelLow > subLow,
        applied_to_high: totHigh - travelHigh > subHigh,
      });
    }
    return { subLow, subHigh, totLow, totHigh };
  });

  return {
    ...stamped,
    priceable: true,
    refusals: [],
    subtotal_low: money(Math.min(...priced.map((p) => p.subLow))),
    subtotal_high: money(Math.max(...priced.map((p) => p.subHigh))),
    total_low: money(Math.min(...priced.map((p) => p.totLow))),
    total_high: money(Math.max(...priced.map((p) => p.totHigh))),
    breakdown: {
      basis: RATE_BASIS,
      material_category: material,
      area_sqft: money(area),
      area_status: row.area_status,
      old_floor_removal: removal,
      lines: [...floorLines, ...removalLines, ...minimumLines, ...travelLines],
    },
  };
};

return $input.all().map((item, i) => ({
  json: priceOne(item.json || {}),
  pairedItem: { item: i },
}));
