const MATERIAL_MAP = [
  ['LVP',      /lvp|lvt|luxury vinyl|vinyl plank|vinyl tile|\bspc\b|\bwpc\b|\bevp\b|rigid core/],
  ['Laminate', /laminate/],
  ['Wood',     /engineered|hardwood|solid wood|\bwood floor(ing)?\b|oak|maple|walnut/],
  ['Vinyl',    /vinyl|linoleum|lino\b/],
  ['Carpet',   /carpet/],
];
const SCOPE_WHITELIST = ['remove_first', 'over_existing'];
const FIXING_WHITELIST = ['click_lock', 'floating', 'glue_down', 'nail_down',
  'staple_down', 'loose_lay', 'peel_and_stick', 'mortar_set', 'thinset'];
const FIXING_NOT_OURS = /mortar_set|thinset/;
const FIXING_NEEDS_SUBFLOOR = /nail_down|staple_down/;
const SLAB = /\bslab\b|concrete/;
const PATTERN_WHITELIST = ['straight', 'staggered', 'random', 'offset', 'brick',
  'diagonal', 'herringbone', 'chevron', 'basketweave'];
const INTENT_WHITELIST = ['new_quote', 'pre_sales_question', 'follow_up', 'offer_response',
  'scheduling', 'billing', 'complaint', 'spam_or_other'];
const EXTRA_LABOUR_PATTERN = /herring|chevron|basketweave/;
const EXTRA_WASTE_PATTERN = /diagonal/;
const COMPARABLE_AREA = ['known', 'converted', 'derived'];
const AREA_MIN = 20;
const AREA_MAX = 20000;
const AREA_LARGE_RESIDENTIAL = 6000;

const RE = {

  phishing: /gift ?card|wire (transfer|instructions|the (payment|funds|money))|(bank|account|wiring|payment|remittance|routing|ach)\s*(details|info|information|number)?\s*(have |has )?(been )?(chang|updat|revis)|(chang\w*|updat\w*|new)\s+(the\s+)?(bank|account|wiring|routing|ach)\b|new (bank|account|wiring|routing)|verify your (account|identity)|confirm your (password|login|credentials)|package (is )?(held|waiting)|customs (fee|clearance)|bitcoin|crypto ?wallet|routing number|invoice[^.]{0,40}(immediate|urgent)|past due[^.]{0,40}wire/,
  money: /deposit|invoice|receipt|paid|payment|zelle|venmo|wire|check (is |was )?(in the mail|sent|mailed)|credit card|balance due|remit|paid in full|cc authorization/,

  schedulingStrong: /reschedul|re-?schedul|cancel (the )?(visit|appointment|measure)|appointment|book (a|the) (measure|visit|slot)|confirm (the )?(time|date|visit|appointment)|see you (on|at)/,
  schedulingWeak: /(can|could|would|will) (you|someone|somebody) come (by|out)|come (by|out) (to|and) (measure|look|see|check|take)|available (on|this|next)|what time|move (it|that|the (visit|appointment|install\w*|date|time)) to (monday|tuesday|wednesday|thursday|friday|saturday|sunday|next|another|a different|later|earlier)/,
  offerYes: /\b(i'?m|we'?re|i am|we are) (good|in)\b|go ahead|let'?s (do|book|proceed|go)|\b(i|we) ('?ll |will )?accept(ed)?\b|\b(accepted|approved)\b|\b(i'?ll|we'?ll|i will|we will) take it\b|book (me|us)( in)?|sign me up|please proceed|sign(ed)? the|it'?s a deal/,
  offerYesWeak: /(sounds|looks) good|works for me|that works|happy with (the|that) (price|quote|number)/,
  offerNo: /too (expensive|high|much|pricey|steep)|out of (our |my )?budget|over (our|my) budget|can you do better|any (discount|room)|beat (that|this) (price|quote)|cheaper|a bit (steep|pricey)|more than (i|we) (expected|thought|wanted)/,

  priceAsk: /how much|what would it cost|what does it cost|cost to install|\bquote\b|\bestimate\b|ballpark|\bpricing\b|price for/,
  preSales: /do you (do|install|offer|serve|cover|work|handle)|can you (do|install|come out to|service)|how (long|soon)|lead ?time|are you (licensed|insured|bonded)|what (brands|options)|warrant(y|ies)|price list|pricelist/,
  operations: /r[ée]sum[ée]|\bcv\b|job application|looking for work|hiring|purchase order|\bpo #|shipment|back ?order|delivery (schedule|eta)|dealer|distributor|seo|rank(ing)? your|more leads|marketing (services|proposal)|guest post|partnership|affiliate|marketing agency/,
  complaintStrong: /complain|unhappy|not (happy|satisfied)|warranty claim|poor (job|quality)|redo|come back and fix|you installed/,
  complaintWeak: /lifting|gap(s|ping)|buckl|peel|crack|squeak|damaged|coming apart/,

  stairs: /\bstairs?\b|staircase|stairwell|stair treads?/,
  scopeWords: /\bremov\w*|tear ?out|rip ?up|haul ?away|dispose|disposal|over the existing|on top of|existing (tile|vinyl|carpet|laminate|hardwood|floor)|underlay\w*|vapou?r barrier|baseboard|transition strip|threshold|subfloor prep/,
  metricArea: /\b(m2|m²|sq ?m|square met(er|re)s?|met(er|re)s?\b)/,
  flooring: /floor|flooring|carpet|vinyl|laminate|hardwood|lvp|lvt|plank|subfloor|underlay|baseboard|sq ?ft|square feet/,
  commercial: /property manag|realtor|\bhoa\b|insurance (claim|adjuster)|multi-?family|apartment complex|bid (invitation|package)|\brfp\b|w-?9|\bcoi\b|certificate of insurance|general contractor/,
};

const SQFT_PER_SQM = 10.7639;
const AREA_UNITS = {
  sqft: { factor: 1, spoken: 'sq ft' },
  sqm: { factor: SQFT_PER_SQM, spoken: 'm²' },
  sqyd: { factor: 9, spoken: 'sq yd' },
};
const AREA_UNIT_WHITELIST = Object.keys(AREA_UNITS);
const SQFT_QUOTED = /sq ?\.? ?ft|square feet|\bsf\b/i;
const UNIT_SPELLED = {
  sqft: /sq ?\.? ?ft|square feet|\bsf\b|\bfeet\b|\bfoot\b/i,
  sqm: /\bm2\b|m²|sq ?m\b|square met|\bmet(er|re)s?\b/i,
  sqyd: /sq ?\.? ?yds?\b|square yards?|\byards?\b/i,
};
const METRIC_QUOTED = /\bm2\b|m²|sq ?m\b|square met|metr/i;
const LINEAR_FEET = /\bft\b|\bfeet\b|\bfoot\b|\d\s*'/i;
const LINEAR_METRES = /\bm\b|\bmet(er|re)s?\b/i;
const DIMENSIONS = /(\d+(?:[.,]\d+)?)\s*(?:x|×|by)\s*(\d+(?:[.,]\d+)?)/i;
const COUNT_NOT_AREA = /\b(rooms?|bedrooms?|bathrooms?|units?|pieces?|boxes?)\b/i;

const num = (v) => Number(String(v ?? '').replace(/,(?=\d{3}\b)/g, '').replace(',', '.'));

const asQuantity = (value, evidenceText, unit) => {
  const ev = String(evidenceText ?? '');
  const raw = num(value);
  if (!Number.isFinite(raw) || raw <= 0) return { status: 'unknown', sqft: null, unit: null, note: null };

  const stated = [...ev.matchAll(/(\d+(?:[.,]\d+)?)\s*(sq ?\.? ?ft|square feet|sf\b|m2|m²|sq ?m)/gi)]
    .map((m) => num(m[1]));
  const metricQuoted = /\bm2\b|m²|sq ?m\b|square met|metr/i.test(ev);
  if (stated.length && !stated.includes(raw)) {
    const alreadyConverted = metricQuoted
      && stated.some((n) => Math.abs(n * SQFT_PER_SQM - raw) <= 2);
    if (alreadyConverted) {
      const rounded = Math.round(raw);
      return { status: 'converted', sqft: rounded, unit: 'sqm',
        note: `${stated[0]} m² had already been converted to ${rounded} sq ft before the gate saw it` };
    }
    return { status: 'contradicted', sqft: null, unit: null,
      note: `the quote says ${stated.join(' and ')} but the value given was ${raw}` };
  }
  const dims = [...ev.matchAll(new RegExp(DIMENSIONS.source, 'gi'))];
  if (dims.length > 1) {
    return { status: 'unknown', sqft: null, unit: null,
      note: `${dims.length} sets of room dimensions — ask the customer for the total` };
  }
  if (dims.length === 1) {
    const product = num(dims[0][1]) * num(dims[0][2]);
    const side = unit || (LINEAR_FEET.test(ev) ? 'sqft' : (LINEAR_METRES.test(ev) ? 'sqm' : null));
    if (!side) {
      return { status: 'no_unit', sqft: null, unit: null,
        note: `"${ev}" multiplies to ${Math.round(product)}, but neither side says feet or metres — ask` };
    }
    const converted = Math.round(product * AREA_UNITS[side].factor);
    return { status: 'derived', sqft: converted, unit: side,
      note: side === 'sqft'
        ? `${dims[0][1]} x ${dims[0][2]} multiplied to ${converted} sq ft`
        : `${dims[0][1]} x ${dims[0][2]} ${AREA_UNITS[side].spoken} multiplied and converted to ${converted} sq ft` };
  }
  if (COUNT_NOT_AREA.test(ev) && !stated.length) {
    return { status: 'not_an_area', sqft: null, unit: null, note: `"${ev}" counts things, it is not an area` };
  }
  if (unit && unit !== 'sqft') {
    const converted = Math.round(raw * AREA_UNITS[unit].factor);
    return { status: 'converted', sqft: converted, unit,
      note: `${raw} ${AREA_UNITS[unit].spoken} converted to ${converted} sq ft` };
  }
  if (unit === 'sqft') return { status: 'known', sqft: Math.round(raw), unit, note: null };
  if (METRIC_QUOTED.test(ev)) {
    const converted = Math.round(raw * SQFT_PER_SQM);
    return { status: 'converted', sqft: converted, unit: 'sqm', note: `${raw} m² converted to ${converted} sq ft` };
  }
  if (SQFT_QUOTED.test(ev)) return { status: 'known', sqft: Math.round(raw), unit: 'sqft', note: null };
  return { status: 'no_unit', sqft: null, unit: null,
    note: `"${ev}" is a number with no unit beside it — ask whether it is square feet, square metres or square yards` };
};

const asPlace = (zone, located) => {
  if (!located) return { status: 'unknown', zone: null };
  if (!zone) return { status: 'unrecognised', zone: null };
  if (zone === 'out') return { status: 'out_of_area', zone };
  return { status: 'known', zone };
};

const asProduct = (rawMaterial, cats, matchCatalogue, offered, declined) => {
  const category = matchCatalogue(rawMaterial);
  if (category && (!cats.length || cats.includes(category))) return { status: 'known', category };
  if (offered) return { status: 'offered_not_priced', category: null, label: offered.label };
  if (declined) return { status: 'out_of_scope', category: null, label: declined.label };
  if (category) return { status: 'not_in_catalogue', category: null, label: category };
  return { status: 'unknown', category: null };
};

const noControls = (v) => JSON.parse(JSON.stringify(v ?? null,
  (k, x) => (typeof x === 'string' ? x.replace(/[\u0000-\u001f]/g, ' ') : x)));

const norm = (s) => String(s ?? '')
  .replace(/[\u2018\u2019\u02BC]/g, "'")
  .replace(/[\u201C\u201D]/g, '"')
  .replace(/[\u2013\u2014]/g, '-')
  .replace(/\s+/g, ' ')
  .trim()
  .toLowerCase();
const ROUTE_OF = {
  quote_request: 'quote', pre_sales: 'quote',
  existing_project: 'project', scheduling: 'project', offer_response: 'project', billing: 'project',
  complaint: 'support',
  operations: 'operations',
  ignore_auto: 'log', owner_reply: 'log',
  unknown: 'review',
};
const HANDLING_OF = {
  pre_sales: 'auto',
  operations: 'none', ignore_auto: 'none', owner_reply: 'none',
};

const out = [];

for (const item of $input.all()) {
  const row = item.json;
  const ex = noControls(row.extracted || {});
  const ev = ex.evidence || {};
  const cats = row.categories || [];
  const src = norm(row.source_text);
  const reasons = [], missing = [], dropped = [];

  const nothingToRead = row.body_empty === true && src.length === 0;
  const fullyQuoted = row.body_fully_quoted === true;
  const isReturning = Number(row.prior_from_contact || 0) > 0 || Number(row.prior_in_thread || 0) > 0;
  const hadOffer = Number(row.prior_offers || 0) > 0;
  const autoSubmitted = norm(row.auto_submitted);
  const isAutomated = (autoSubmitted !== '' && autoSubmitted !== 'no')
    || /bulk|junk|list|auto_reply/.test(norm(row.precedence))
    || row.list_unsubscribe === true;

  const grounded = (field) => {
    const q = norm(ev[field]);
    if (q.length < 2 || src.length === 0) return false;
    const left = /^\w/.test(q) ? '\\b' : '';
    const right = /\w$/.test(q) ? '\\b' : '';
    return new RegExp(left + q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + right).test(src);
  };
  const take = (field, value) => {
    if (value === null || value === undefined || value === '') return null;
    if (grounded(field)) return value;
    dropped.push(field);
    return null;
  };

  const rawMaterial = take('material', ex.material);
  const matchCatalogue = (raw) => {
    for (const [cat, re] of MATERIAL_MAP) if (re.test(String(raw || '').toLowerCase())) return cat;
    return null;
  };

  const services = Array.isArray(row.services) ? row.services : [];
  const serviceHits = (wanted) => services.filter((s) => s && s.we_do === wanted).find((s) => {
    let re;
    try {
      re = new RegExp(s.match_words, 'i');
    } catch (e) {
      reasons.push(`service rule "${s.label}" has an unusable pattern and was skipped`);
      return false;
    }
    return re.test(src) || re.test(String(rawMaterial || ''));
  });
  const offered = serviceHits(true);
  const declinedRaw = serviceHits(false);
  const product = asProduct(rawMaterial, cats, matchCatalogue, offered, declinedRaw);
  const material = product.category;
  if (product.status === 'not_in_catalogue') {
    reasons.push(`material "${rawMaterial}" is not in the price catalogue`);
  }
  const declined = product.status === 'out_of_scope' ? declinedRaw : null;
  // The service that matched has an answer written next to it in the database, and the gate has
  // already done the matching. Handing the text on rather than the label keeps the matching in one
  // place: anything that answered a customer by matching again would be a second copy of this.
  const answering = declinedRaw || offered || null;

  const unitInWords = (text) => {
    const s = String(text ?? '');
    for (const unit of AREA_UNIT_WHITELIST) if (UNIT_SPELLED[unit].test(s)) return unit;
    return null;
  };
  const areaUnitRaw = norm(take('area_unit', ex.area_unit));
  const unitClaimed = unitInWords(areaUnitRaw);
  const unitQuoted = unitInWords(ev.area_unit);
  const areaUnit = unitClaimed && unitClaimed === unitQuoted ? unitClaimed : null;
  if (areaUnitRaw && !areaUnit) {
    reasons.push(unitQuoted
      ? `the unit was given as "${areaUnitRaw}" but the words quoted for it read as `
        + `${unitQuoted} — the two do not agree, so no unit was accepted`
      : `"${areaUnitRaw}" was offered as the unit and the words quoted for it, `
        + `"${ev.area_unit}", name no unit at all`);
  }
  const quantity = asQuantity(take('area_sqft', ex.area_sqft), ev.area_sqft, areaUnit);
  const area = quantity.sqft;
  const areaOk = Number.isFinite(area) && area > 0;
  if (quantity.note) reasons.push(quantity.note);

  const cityGrounded = grounded('city');
  const zipGrounded = grounded('zip');
  const locationGrounded = cityGrounded || zipGrounded;
  if (!locationGrounded && (ex.city || ex.zip)) dropped.push('city');
  const place = asPlace((zipGrounded ? row.zone_by_zip : null)
    || (cityGrounded ? row.zone_by_city : null) || null, locationGrounded);
  const zone = place.zone;
  const city = cityGrounded ? (String(ex.city ?? '').replace(/\s+/g, ' ').trim() || null) : null;

  const patternRaw = norm(take('pattern', ex.pattern));
  const pattern = PATTERN_WHITELIST.includes(patternRaw) ? patternRaw : null;
  if (patternRaw && !pattern) reasons.push(`"${patternRaw}" is not a known laying pattern — ignored`);

  const scopeRaw = norm(take('existing_floor_action', ex.existing_floor_action));
  const scope = SCOPE_WHITELIST.includes(scopeRaw) ? scopeRaw : null;
  const fixingRaw = norm(take('fixing_method', ex.fixing_method));
  const fixing = FIXING_WHITELIST.includes(fixingRaw) ? fixingRaw : null;
  const removal = take('old_floor_removal', ex.old_floor_removal === true ? true
    : (ex.old_floor_removal === false ? false : null));
  const floorLevel = norm(take('floor_level', ex.floor_level));
  const subfloor = take('subfloor_flag', ex.subfloor_flag === true ? true : null) === true;
  const lift = take('lift', ex.lift === true ? true : null) === true;
  const commercialClaim = take('is_commercial', ex.is_commercial === true ? true : null) === true;
  const intent = norm(ex.intent);
  const said = (re) => re.test(src);

  const priorSignatures = Array.isArray(row.prior_signatures) ? row.prior_signatures : [];
  const sameSignature = !!material && areaOk && COMPARABLE_AREA.includes(quantity.status)
    && priorSignatures.some((s) => s && s.m === material
      && COMPARABLE_AREA.includes(s.st) && Number(s.a) === area);


  const danger = said(RE.phishing);

  let category, matchedRule;

  if (row.is_outbound === true) {
    category = 'owner_reply';
    matchedRule = 'owner_sent';
    reasons.push('sent by the owner, not received — recorded so the bot stays out of this thread');
  } else if (isAutomated) {
    category = 'ignore_auto';
    matchedRule = 'automated_headers';
    reasons.push('automated mail (headers) — never answer, avoids reply loops');
  } else if (danger && !isReturning) {
    category = 'ignore_auto';
    matchedRule = 'fraud_unknown_sender';
    reasons.push('phishing indicators from an unknown sender — do not act, do not reply');
  } else if (nothingToRead) {
    category = 'unknown';
    matchedRule = 'nothing_readable';
    reasons.push(row.has_photo
      ? 'no text in the email but a photo is attached — read the attachment'
      : 'no readable text at all');
  } else if (said(RE.complaintStrong)
             || (said(RE.complaintWeak) && (isReturning || hadOffer) && !(material && areaOk))
             || (intent === 'complaint' && (said(RE.complaintWeak) || isReturning)
                 && !(material && areaOk))) {
    category = 'complaint';
    matchedRule = 'complaint_signal';
    reasons.push('complaint — the owner answers personally, never a price');
  } else if (isReturning && (said(RE.offerYes) || said(RE.offerNo)
             || (said(RE.offerYesWeak) && !(material && areaOk)))) {
    category = 'offer_response';
    matchedRule = 'offer_response';
    reasons.push(said(RE.offerYes) || said(RE.offerYesWeak)
      ? 'looks like acceptance — changes job state, needs the owner NOW'
      : 'price pushback — negotiation, owner decides');
  } else if (isReturning && said(RE.money)) {
    category = 'billing';
    matchedRule = 'money_known_contact';
    reasons.push('money mentioned by a known contact — do not lose it');
  } else if (said(RE.schedulingStrong)
             || (intent === 'scheduling' && (said(RE.schedulingStrong) || said(RE.schedulingWeak)))
             || (isReturning && said(RE.schedulingWeak))) {
    category = 'scheduling';
    matchedRule = 'scheduling_signal';
    reasons.push('about a date or a visit — calendar, not pricing');
  } else if (sameSignature) {
    category = 'existing_project';
    matchedRule = 'same_job_signature';
    reasons.push('same material and area already asked by this contact recently — '
      + 'do NOT send a second quote, check what went out already');
  } else if (isReturning && !(material && areaOk)
             && (Number(row.prior_in_thread || 0) > 0 || intent === 'follow_up')) {
    category = 'existing_project';
    matchedRule = 'thread_continuation';
    reasons.push('known contact continuing an existing conversation — check history first');
  } else if (said(RE.operations)) {
    category = 'operations';
    matchedRule = 'not_a_customer';
    reasons.push('not a customer (supplier / applicant / agency) — digest only, never auto-reply');
  } else if (said(RE.preSales) && !said(RE.priceAsk) && !(material && areaOk)) {
    category = 'pre_sales';
    matchedRule = 'capability_question';
    reasons.push('capability or availability question, no price asked');
  } else if (material || areaOk || said(RE.flooring)) {

    category = 'quote_request';
    matchedRule = 'wants_a_price';
  } else {
    category = 'unknown';
    matchedRule = 'unclassified';
    reasons.push('could not classify — owner decides');
  }

  let color = null, autoBlocked = false, areaNeedsConfirming = false, scopeUnknown = false;
  const outOfScope = !!declined && ['quote_request', 'pre_sales'].includes(category);
  if (outOfScope) reasons.push(`not a service this firm offers (${declined.label}) — ${declined.answer}`);
  const assumptions = [];

  if (category === 'quote_request') {
    if (!material) missing.push('material');
    if (!areaOk) missing.push('area_sqft');
    if (!zone) missing.push('location');

    if (zone === 'out') reasons.push('outside the service area (Austin + 30 mi)');
    if (subfloor) reasons.push('subfloor/moisture flag — site survey needed');
    if (pattern && EXTRA_LABOUR_PATTERN.test(pattern)) {
      reasons.push(`pattern work (${pattern}) — extra labour and waste`);
    }
    if (pattern && EXTRA_WASTE_PATTERN.test(pattern)) {
      reasons.push(`${pattern} layout — extra waste, modest extra labour`);
    }
    if (areaOk && area > AREA_LARGE_RESIDENTIAL && area <= AREA_MAX) {
      reasons.push(`${area} sq ft is unusually large for residential — confirm before pricing`);
    }
    if (said(RE.stairs)) {
      scopeUnknown = true;
      reasons.push('stairs are charged per step, not per sq ft — the formula cannot express them');
    } else if (removal === true || scope === 'remove_first') {
      reasons.push('the old floor comes out — removal and disposal are charged per sq ft on top');
    } else if (scope === 'over_existing') {
      reasons.push('laying over the existing floor — check height at doors and that the surface is sound');
    } else if (said(RE.scopeWords)) {
      scopeUnknown = true;
      reasons.push('the email talks about the existing floor but the scope did not come through — ask');
    } else {
      assumptions.push('no removal or disposal of the existing floor is included');
      assumptions.push('the price assumes a sound, level subfloor with no preparation work');
      assumptions.push('stairs, thresholds and baseboards are not included');
    }

    if (fixing && FIXING_NOT_OURS.test(fixing)) {
      scopeUnknown = true;
      reasons.push(`${fixing} is tile work — it is not in the price book, the owner decides`);
    } else if (fixing && FIXING_NEEDS_SUBFLOOR.test(fixing) && (said(SLAB) || subfloor)) {
      scopeUnknown = true;
      reasons.push(`${fixing} over a concrete slab needs a plywood subfloor first — site check`);
    } else if (fixing === 'glue_down') {
      reasons.push('glue-down installation — higher labour rate than a floating floor');
    } else if (!fixing) {
      assumptions.push('the price assumes a floating click-lock installation');
    }

    const upper = floorLevel && !/\b(ground|first|1st|main|slab)\b/.test(floorLevel);
    if (upper && !lift) {
      reasons.push(`upper floor (${floorLevel}), no lift stated — access surcharge`);
    }
    if (intent === 'follow_up') {
      reasons.push('follow-up in an existing thread — check history before replying');
    }

    if (quantity.status === 'converted' || quantity.status === 'derived') {
      areaNeedsConfirming = true;
    } else if (areaOk && said(RE.metricArea)) {
      areaNeedsConfirming = true;
      missing.push('area_sqft');
      reasons.push('the email mentions metric units but the quoted words do not — ask which unit the number is in');
    }

    if (scopeUnknown || outOfScope) autoBlocked = true;

    const isRed = outOfScope || missing.length > 0 || zone === 'out' || subfloor
      || (areaOk && (area < AREA_MIN || area > AREA_MAX));
    if (isRed) color = 'red';
    else if (zone === 'edge' || scopeUnknown || reasons.length > 0) color = 'yellow';
    else color = 'green';

    if (color === 'yellow' && zone === 'edge') reasons.push('edge of the service area — travel fee applies');
    if (missing.length) reasons.push(`ask the customer for: ${missing.join(', ')}`);

  } else if (['complaint', 'offer_response', 'billing', 'scheduling', 'existing_project', 'unknown'].includes(category)) {
    color = category === 'offer_response' || category === 'complaint' ? 'red' : 'yellow';
  }

  if (areaNeedsConfirming) autoBlocked = true;

  if (fullyQuoted) {
    if (color === 'green') color = 'red';
    autoBlocked = true;
    reasons.push('the message contains only quoted history — confirm the facts are current');
  }

  if (row.needs_sender_extraction === true) {
    if (color === 'green') color = 'yellow';
    autoBlocked = true;
    reasons.push('platform lead: the customer address is not in the headers — take it from the body');
  }

  if (dropped.length) {
    if (color === 'green') color = 'yellow';
    autoBlocked = true;
    reasons.push(`ignored, no matching words in the email (possible fabrication): ${dropped.join(', ')}`);
  }

  if (danger) {
    autoBlocked = true;
    if (!['ignore_auto', 'owner_reply', 'operations'].includes(category)) color = 'red';
    reasons.unshift('⚠️ payment/credential details being changed — verify by PHONE, never act on this email alone');
  }

  const segment = (commercialClaim || said(RE.commercial)) ? 'commercial' : 'residential';
  if (segment === 'commercial') {
    if (color === 'green') color = 'yellow';
    autoBlocked = true;
    reasons.push('commercial / managed property — different price book, never auto');
  }

  const pricingAllowed = category === 'quote_request' && color === 'green' && !autoBlocked;

  let route = ROUTE_OF[category];
  let handling = HANDLING_OF[category] || 'manual_review';
  if (!route) {
    route = 'review';
    handling = 'manual_review';
    reasons.push(`category "${category}" has no route — sent for manual review`);
  }
  if (handling === 'auto' && autoBlocked) handling = 'manual_review';
  if (handling === 'manual_review' && color === null) color = 'yellow';

  // Whether a number can be a floor is a fact about the number, not about the kind of email it
  // arrived in. This lived inside the branch for a first enquiry, so the same 200000 sq ft was
  // red on a new thread and yellow on a reply in the same thread — and everything downstream
  // that trusts the colour let it through the second time.
  const areaUsable = areaOk && area >= AREA_MIN && area <= AREA_MAX;
  if (areaOk && !areaUsable) {
    reasons.push(`area ${area} sq ft is outside the plausible range ${AREA_MIN}-${AREA_MAX}`);
    color = 'red';
  }

  // What the gate will stand behind, as one object, separate from what it reports for a person to
  // read. Colour answers where an email goes and who looks at it; whether a single number can be
  // a floor is a fact about the number. Guarding the merge on colour conflated the two and cost a
  // hole in each direction on the same day: an absurd area slipping in mid-conversation, and an
  // ordinary "laminate, size to follow" contributing nothing because incomplete is also red.
  //
  // The merge reads this and nothing else, so there is one place that decides what is believed —
  // rather than nine fields gathered by an expression in a workflow, where a value the gate had
  // already refused could be picked up again.
  const settled = {
    material_category: material,
    area_sqft: areaUsable ? area : null,
    area_unit: areaUsable ? quantity.unit : null,
    area_status: areaUsable ? quantity.status : null,
    city,
    zone,
    existing_floor_action: scope,
    fixing_method: fixing,
    old_floor_removal: removal,
  };

  out.push({ json: {
    gmail_message_id: row.gmail_message_id,
    extracted: ex,
    category,
    route,
    handling,
    pricing_allowed: pricingAllowed,
    segment,
    is_returning: isReturning,
    same_signature: sameSignature,
    danger,
    intent: INTENT_WHITELIST.includes(intent) ? intent : null,
    material_category: material,
    area_sqft: areaOk ? area : null,
    settled,
    area_status: quantity.status,
    area_comparable: COMPARABLE_AREA.includes(quantity.status),
    area_unit: quantity.unit,
    place_status: place.status,
    product_status: product.status,
    pattern,
    geo_zone: zone,
    city,
    gate_color: color,
    gate_reasons: reasons,
    matched_rule: matchedRule,
    out_of_scope: declined ? declined.label : null,
    service_label: answering ? answering.label : null,
    service_answer: answering ? answering.answer : null,
    service_we_do: answering ? answering.we_do : null,
    existing_floor_action: scope,
    fixing_method: fixing,
    old_floor_removal: removal,
    assumptions,
    missing_fields: missing,
    dropped_fields: dropped,
  }});
}

return out;
