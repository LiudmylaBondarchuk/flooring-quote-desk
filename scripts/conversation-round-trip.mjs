import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const url = process.env.CHECK_DATABASE_URL;
if (!url) {
  console.error('CHECK_DATABASE_URL is not set — point it at an empty throwaway database. It gets written to.');
  process.exit(1);
}

const read = (...p) => readFileSync(join(root, ...p), 'utf8');
const run = (args, input) => execFileSync('psql', [url, '-q', ...args], { input, encoding: 'utf8' });
const ask = (sql) => execFileSync('psql', [url, '-t', '-A', '-c', sql], { encoding: 'utf8' }).trim();

if (ask("SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'") !== '0') {
  console.error('refusing to run: CHECK_DATABASE_URL is not empty. It must be disposable.');
  process.exit(1);
}

run(['-v', 'ON_ERROR_STOP=1'], read('db', 'schema.sql'));
run(['-v', 'ON_ERROR_STOP=1'], read('db', 'seeds', 'reference-data.sql'));

const literal = (v) => {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') return String(v);
  const text = String(v);
  let tag = 'lit';
  while (text.includes(`$${tag}$`)) tag += 'x';
  return `$${tag}$${text}$${tag}$`;
};

const fill = (sql, values) => sql.replace(/\$(\d+)/g, (whole, n) => {
  const i = Number(n);
  return i >= 1 && i <= values.length ? literal(values[i - 1]) : whole;
});

const params = (path) => {
  const body = JSON.parse(read(path)).queryReplacement.replace(/^=\{\{\s*/, '').replace(/\s*\}\}$/, '');
  return new Function('$json', '$', `return ${body}`);
};

const node = (source, items) =>
  new Function('$input', source)({ all: () => items.map((json) => ({ json })) });

const prepareSource = read('src', '00-intake-router', 'prepare-fields.js');
const gateSource = read('src', '00-intake-router', 'decision-gate.js');

const sqlOf = (n) => read('db', '00-intake-router', `${n}.sql`).replace(/;\s*$/, '');
const paramsOf = (n) => params(join('db', '00-intake-router', `${n}.params.json`));

const logSql = sqlOf('log-inbound-dedupe');
const logParams = paramsOf('log-inbound-dedupe');
const lookupSql = sqlOf('lookup-geo-catalogue-history');
const lookupParams = paramsOf('lookup-geo-catalogue-history');
const triageSql = sqlOf('save-triage');
const triageParams = paramsOf('save-triage');
const findSql = sqlOf('find-or-create-an-order');
const mergeSql = sqlOf('merge-the-facts');

// The names come from the database, not from parsing the SQL for `AS`: a column without an alias
// or a table alias after FROM would otherwise shift every value onto the wrong name. psql prints
// the header when -t is left off, and that header is the statement's own answer.
const rowOf = (sql, values) => {
  const out = execFileSync('psql',
    [url, '-A', '-F', '|', '-P', 'footer=off', '-c', fill(sql, values)], { encoding: 'utf8' });
  const [head, body] = out.trim().split('\n');
  const names = head.split('|');
  const parts = body.split('|');
  if (names.length !== parts.length) {
    throw new Error(`the statement named ${names.length} columns and returned ${parts.length} values`);
  }
  return Object.fromEntries(names.map((n, i) => [n, parts[i]]));
};

const TOUCHES = ['quote_request', 'existing_project', 'scheduling', 'offer_response', 'billing'];

// One email, all the way through the router as the workflow wires it: prepared, logged, looked
// up, decided, stored, attached to an order, merged. Nothing here is a stand-in — every step is
// the file the instance runs.
const arrive = ({ id, thread, from, text, extracted, headers }) => {
  const [prepared] = node(prepareSource, [{
    id, threadId: thread, labelIds: ['INBOX'],
    from: { value: [{ address: from, name: from.split('@')[0] }] },
    text, html: '', headers: headers || {},
  }]);
  run(['-c', fill(logSql, logParams(prepared.json))]);

  const lookup = JSON.parse(ask(
    `SELECT row_to_json(t) FROM (${fill(lookupSql, lookupParams({ output: extracted || {} },
      () => ({ item: { json: prepared.json } })))}) t`));

  const [decided] = node(gateSource, [{ ...lookup, gmail_message_id: id }]);
  const d = decided.json;
  run(['-c', fill(triageSql, triageParams(d))]);

  const found = rowOf(findSql,
    [id, prepared.json.thread_id, prepared.json.contact_email, TOUCHES.includes(d.category)]);

  const merged = rowOf(mergeSql,
    [id, found.order_id === '' ? null : found.order_id, JSON.stringify(d.settled),
      d.category, d.route, d.handling, d.gate_color]);

  return { decision: d, order_id: found.order_id === '' ? null : Number(found.order_id), merged };
};

const missing = (raw) => (raw === '{}' || raw === '' || raw === undefined
  ? [] : raw.replace(/^\{|\}$/g, '').split(',').filter(Boolean));

const quoteSql = (n) => read('db', '10-quote', `${n}.sql`).replace(/;\s*$/, '');
const computeSource = read('src', '10-quote', 'compute-quote.js');

// gather -> compute -> write, the three steps the lane runs, with nothing standing in for any
const priceIt = (id) => {
  const gathered = JSON.parse(ask(
    `SELECT row_to_json(t) FROM (${fill(quoteSql('gather-what-a-price-needs'), [id])}) t`));
  const [computed] = node(computeSource, [gathered]);
  const q = computed.json;
  if (!q.priceable) return { gathered, quote: q, written: null };
  const written = rowOf(quoteSql('write-the-offer'),
    [id, gathered.order_id, q.subtotal_low, q.subtotal_high, q.total_low, q.total_high,
      JSON.stringify(q.breakdown), q.pricing_version]);
  return { gathered, quote: q, written };
};

const orderOf = (id) => JSON.parse(ask(
  `SELECT row_to_json(o) FROM (SELECT material_category, area_sqft, area_unit, city, zone, state
     FROM orders WHERE id = ${literal(String(id))}::int) o`));

let failed = 0;
const check = (what, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed += 1;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}${ok ? '' : `\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`}`);
};

const ev = (words) => ({ material: 'lvp', ...words });

console.log('\none customer, one email, everything the price needs');
{
  const a = arrive({
    id: 'c1-1', thread: 'th-c1', from: 'anna@example.com',
    text: 'hi, i need lvp in the living room, about 320 sq ft, round rock tx',
    extracted: { intent: 'new_quote', material: 'lvp', area_sqft: 320, area_unit: 'sqft',
      city: 'round rock', evidence: ev({ area_sqft: '320', area_unit: 'sq ft', city: 'round rock' }) },
  });
  check('an order was opened', a.order_id !== null, true);
  check('the facts landed on it', orderOf(a.order_id),
    { material_category: 'LVP', area_sqft: 320, area_unit: 'sqft', city: 'round rock', zone: 'core', state: 'new' });
  check('nothing is still missing', missing(a.merged.still_missing), []);
}

console.log('\none customer, three emails, the facts arriving in pieces');
{
  const first = arrive({
    id: 'c2-1', thread: 'th-c2', from: 'ben@example.com',
    text: 'i want laminate in the hallway, cedar park tx, not sure of the size yet',
    extracted: { intent: 'new_quote', material: 'laminate', city: 'cedar park',
      evidence: { material: 'laminate', city: 'cedar park' } },
  });
  check('the first email opens the order', first.order_id !== null, true);
  check('and it knows the area is what is missing', missing(first.merged.still_missing), ['area_sqft']);

  const second = arrive({
    id: 'c2-2', thread: 'th-c2', from: 'ben@example.com',
    text: 'about 450 sq ft, sorry forgot to say',
    extracted: { intent: 'new_quote', area_sqft: 450, area_unit: 'sqft',
      evidence: { area_sqft: '450', area_unit: 'sq ft' } },
  });
  check('the second email joins the same order', second.order_id, first.order_id);
  check('and nothing is missing any more', missing(second.merged.still_missing), []);
  check('the material from the first email is still there', orderOf(second.order_id).material_category, 'Laminate');

  const third = arrive({
    id: 'c2-3', thread: 'th-c2', from: 'ben@example.com',
    text: 'thanks, looking forward to it',
    extracted: { intent: 'follow_up', evidence: {} },
  });
  check('a third email with nothing in it joins the same order', third.order_id, first.order_id);
  check('and changes nothing', orderOf(third.order_id).area_sqft, 450);
}

console.log('\na question first, then the work');
{
  const asked = arrive({
    id: 'q1', thread: 'th-q', from: 'quinn@example.com',
    text: 'hi, do you install laminate? cedar park tx',
    extracted: { intent: 'pre_sales_question', material: 'laminate', city: 'cedar park',
      evidence: { material: 'laminate', city: 'cedar park' } },
  });
  check('a question about what the firm does opens no order', asked.order_id, null);

  const then = arrive({
    id: 'q2', thread: 'th-q', from: 'quinn@example.com',
    text: 'great — it is about 450 sq ft',
    extracted: { intent: 'new_quote', area_sqft: 450, area_unit: 'sqft',
      evidence: { area_sqft: '450', area_unit: 'sq ft' } },
  });
  check('the second email opens one', then.order_id !== null, true);
  check('and it already knows the material from the question', orderOf(then.order_id).material_category, 'Laminate');
  check('and the town', orderOf(then.order_id).city, 'cedar park');
  check('with the area from this email', orderOf(then.order_id).area_sqft, 450);
  check('so nothing is left to ask for', missing(then.merged.still_missing), []);
}

console.log('\ntwo questions, the second correcting the first, then the work');
{
  arrive({
    id: 'r1', thread: 'th-r', from: 'rosa@example.com',
    text: 'hi, do you do carpet? buda tx',
    extracted: { intent: 'pre_sales_question', material: 'carpet', city: 'buda',
      evidence: { material: 'carpet', city: 'buda' } },
  });
  arrive({
    id: 'r2', thread: 'th-r', from: 'rosa@example.com',
    text: 'actually i think laminate, and it is kyle tx not buda',
    extracted: { intent: 'pre_sales_question', material: 'laminate', city: 'kyle',
      evidence: { material: 'laminate', city: 'kyle' } },
  });
  const work = arrive({
    id: 'r3', thread: 'th-r', from: 'rosa@example.com',
    text: 'about 260 sq ft',
    extracted: { intent: 'new_quote', area_sqft: 260, area_unit: 'sqft',
      evidence: { area_sqft: '260', area_unit: 'sq ft' } },
  });
  check('the later question wins on material', orderOf(work.order_id).material_category, 'Laminate');
  check('and on the town', orderOf(work.order_id).city, 'kyle');
  check('the order still has this email\'s area', orderOf(work.order_id).area_sqft, 260);
}

console.log('\na thread where an earlier message settled nothing at all');
{
  arrive({
    id: 's1', thread: 'th-s', from: 'sam@example.com',
    text: 'hello?',
    extracted: { intent: 'pre_sales_question', evidence: {} },
  });
  const work = arrive({
    id: 's2', thread: 'th-s', from: 'sam@example.com',
    text: 'vinyl in the kitchen, 140 sq ft, hutto tx',
    extracted: { intent: 'new_quote', material: 'vinyl', area_sqft: 140, area_unit: 'sqft', city: 'hutto',
      evidence: { material: 'vinyl', area_sqft: '140', area_unit: 'sq ft', city: 'hutto' } },
  });
  check('an empty earlier message costs nothing', orderOf(work.order_id).material_category, 'Vinyl');
  check('and the order is complete', missing(work.merged.still_missing), []);
}

console.log('\na second job in a thread whose first job was booked');
{
  const first = arrive({
    id: 't1', thread: 'th-t', from: 'tara@example.com',
    text: 'lvp 300 sq ft, manor tx',
    extracted: { intent: 'new_quote', material: 'lvp', area_sqft: 300, area_unit: 'sqft', city: 'manor',
      evidence: { material: 'lvp', area_sqft: '300', area_unit: 'sq ft', city: 'manor' } },
  });
  run(['-c', `UPDATE orders SET state = 'booked', closed_at = now() WHERE id = ${first.order_id}`]);
  const second = arrive({
    id: 't2', thread: 'th-t', from: 'tara@example.com',
    text: 'now the bedroom too, carpet, 190 sq ft',
    extracted: { intent: 'new_quote', material: 'carpet', area_sqft: 190, area_unit: 'sqft',
      evidence: { material: 'carpet', area_sqft: '190', area_unit: 'sq ft' } },
  });
  check('the second job is its own order', second.order_id !== first.order_id, true);
  check('it takes the new material, not the booked one', orderOf(second.order_id).material_category, 'Carpet');
  check('and the finished job keeps its own', orderOf(first.order_id).material_category, 'LVP');
  check('the booked area did not follow it', orderOf(second.order_id).area_sqft, 190);
}

console.log('\na customer who measured in metres');
{
  const a = arrive({
    id: 'c3-1', thread: 'th-c3', from: 'carla@example.com',
    text: 'engineered wood please, about 32 m² , austin tx',
    extracted: { intent: 'new_quote', material: 'engineered wood', area_sqft: 32, area_unit: 'sqm',
      city: 'austin',
      evidence: { material: 'engineered wood', area_sqft: '32', area_unit: 'm²', city: 'austin' } },
  });
  check('the area was converted, not refused', orderOf(a.order_id).area_sqft, 344);
  check('and the unit it was given in is remembered', orderOf(a.order_id).area_unit, 'sqm');
  check('nothing is missing', missing(a.merged.still_missing), []);
}

console.log('\nthree conversations at once, arriving interleaved');
{
  const threads = [
    ['d1', 'dana@example.com', 'th-d1', 'carpet for the bedroom, 200 sq ft, buda tx', 'carpet', 200, 'buda'],
    ['d2', 'evan@example.com', 'th-d2', 'vinyl in the kitchen, 150 sq ft, kyle tx', 'vinyl', 150, 'kyle'],
    ['d3', 'fay@example.com', 'th-d3', 'lvp throughout, 800 sq ft, leander tx', 'lvp', 800, 'leander'],
  ];
  const opened = {};
  threads.forEach(([tag, from, thread, text, material, area, city]) => {
    const a = arrive({ id: `${tag}-1`, thread, from, text,
      extracted: { intent: 'new_quote', material, area_sqft: area, area_unit: 'sqft', city,
        evidence: { material, area_sqft: String(area), area_unit: 'sq ft', city } } });
    opened[tag] = a.order_id;
  });
  // and now a second email for each, out of order
  ['d3', 'd1', 'd2'].forEach((tag) => {
    const [, from, thread] = threads.find(([t]) => t === tag);
    const a = arrive({ id: `${tag}-2`, thread, from, text: 'and please take the old floor away',
      extracted: { intent: 'new_quote', old_floor_removal: true, evidence: { old_floor_removal: 'take the old floor away' } } });
    check(`${tag}'s second email joined ${tag}'s order`, a.order_id, opened[tag]);
  });
  check('three orders, not one and not six', new Set(Object.values(opened)).size, 3);
  check('dana still has her own area', orderOf(opened.d1).area_sqft, 200);
  check('evan still has his', orderOf(opened.d2).area_sqft, 150);
  check('fay still has hers', orderOf(opened.d3).area_sqft, 800);
}

console.log('\na red message in the middle of a good conversation');
{
  const first = arrive({
    id: 'g1', thread: 'th-g', from: 'gil@example.com',
    text: 'lvp please, 300 sq ft, austin tx',
    extracted: { intent: 'new_quote', material: 'lvp', area_sqft: 300, area_unit: 'sqft', city: 'austin',
      evidence: ev({ area_sqft: '300', area_unit: 'sq ft', city: 'austin' }) },
  });
  const before = orderOf(first.order_id);

  const bad = arrive({
    id: 'g2', thread: 'th-g', from: 'gil@example.com',
    text: 'actually make it 200000 sq ft',
    extracted: { intent: 'new_quote', material: 'lvp', area_sqft: 200000, area_unit: 'sqft',
      evidence: { material: 'lvp', area_sqft: '200000', area_unit: 'sq ft' } },
  });
  check('the gate refused that message', bad.decision.gate_color, 'red');
  check('and the order is exactly as it was', orderOf(first.order_id), before);

  const after = arrive({
    id: 'g3', thread: 'th-g', from: 'gil@example.com',
    text: 'sorry, 300 sq ft, and please remove the old floor',
    extracted: { intent: 'new_quote', old_floor_removal: true,
      evidence: { old_floor_removal: 'remove the old floor' } },
  });
  check('the conversation carries on in the same order', after.order_id, first.order_id);
  check('and the absurd area never got in', orderOf(first.order_id).area_sqft, 300);
}

console.log('\nthe same customer, a second job, after the first was booked');
{
  const first = arrive({
    id: 'h1', thread: 'th-h1', from: 'hana@example.com',
    text: 'laminate in the hallway, 210 sq ft, hutto tx',
    extracted: { intent: 'new_quote', material: 'laminate', area_sqft: 210, area_unit: 'sqft', city: 'hutto',
      evidence: { material: 'laminate', area_sqft: '210', area_unit: 'sq ft', city: 'hutto' } },
  });
  run(['-c', `UPDATE orders SET state = 'booked', closed_at = now() WHERE id = ${first.order_id}`]);

  const second = arrive({
    id: 'h2', thread: 'th-h2', from: 'hana@example.com',
    text: 'hi again, now the bedroom — carpet, 180 sq ft, hutto tx',
    extracted: { intent: 'new_quote', material: 'carpet', area_sqft: 180, area_unit: 'sqft', city: 'hutto',
      evidence: { material: 'carpet', area_sqft: '180', area_unit: 'sq ft', city: 'hutto' } },
  });
  check('the new job is a new order', second.order_id !== first.order_id, true);
  check('the booked one kept its floor', orderOf(first.order_id).area_sqft, 210);
  check('and the new one has its own', orderOf(second.order_id).area_sqft, 180);
  check('the finished job is still finished', orderOf(first.order_id).state, 'booked');
}

console.log('\na customer who says nothing more');
{
  const a = arrive({
    id: 'i1', thread: 'th-i', from: 'ivan@example.com',
    text: 'how much for vinyl in a small bathroom? austin tx',
    extracted: { intent: 'new_quote', material: 'vinyl', city: 'austin',
      evidence: { material: 'vinyl', city: 'austin' } },
  });
  check('the order is open and waiting', orderOf(a.order_id).state, 'new');
  check('and it knows what it is waiting for', missing(a.merged.still_missing), ['area_sqft']);
  check('it can be found by anyone looking for stalled work',
    Number(ask("SELECT count(*) FROM orders WHERE state = 'new' AND area_sqft IS NULL")) >= 1, true);
}

console.log('\na complete order is priced and the price is written down');
{
  const a = arrive({
    id: 'p1', thread: 'th-p', from: 'pia@example.com',
    text: 'lvp please, 400 sq ft, round rock tx',
    extracted: { intent: 'new_quote', material: 'lvp', area_sqft: 400, area_unit: 'sqft',
      city: 'round rock',
      evidence: { material: 'lvp', area_sqft: '400', area_unit: 'sq ft', city: 'round rock' } },
  });
  const priced = priceIt('p1');
  check('the gate let this one be priced', priced.gathered.pricing_allowed, true);
  check('the catalogue gave it a band', priced.gathered.bands.length > 0, true);
  check('a price came out', priced.quote.priceable, true);
  check('the range is the right way round', priced.quote.total_low <= priced.quote.total_high, true);
  check('the breakdown names what it charged for',
    [...new Set(priced.quote.breakdown.lines.map((l) => l.kind))].sort(), ['floor']);

  const stored = JSON.parse(ask("SELECT row_to_json(o) FROM (SELECT total_low, total_high, status,"
    + ` pricing_version, breakdown IS NOT NULL AS has_breakdown FROM offers WHERE id = ${priced.written.offer_id}) o`));
  check('the offer holds what was computed',
    [Number(stored.total_low), Number(stored.total_high)], [priced.quote.total_low, priced.quote.total_high]);
  check('and it is a draft, not something sent', stored.status, 'draft');
  check('with the arithmetic it came from', stored.pricing_version, priced.quote.pricing_version);
  check('and the parts it is made of', stored.has_breakdown, true);

  check('the order moved to quoted', orderOf(a.order_id).state, 'quoted');
  check('and the move says what it moved from', JSON.parse(ask(
    "SELECT coalesce(json_agg(json_build_object('from', old_value, 'to', new_value)), '[]'::json)"
    + ` FROM order_events WHERE order_id = ${a.order_id} AND kind = 'state_change'`)),
  [{ from: 'new', to: 'quoted' }]);
}

console.log('\nasking for the old floor to be taken away stops the price');
{
  // Not an approval of this. The arithmetic has a removal line and a rate for it, and cannot
  // reach either: any reason at all turns the message yellow, pricing_allowed needs green, and
  // "the old floor comes out" is a note about what will be charged, not a doubt about anything.
  // Recorded so it is visible rather than discovered again from a customer who never got a quote.
  arrive({
    id: 'p3', thread: 'th-p3', from: 'nadia@example.com',
    text: 'laminate, 300 sq ft, buda tx, and please take the old floor away',
    extracted: { intent: 'new_quote', material: 'laminate', area_sqft: 300, area_unit: 'sqft',
      city: 'buda', old_floor_removal: true,
      evidence: { material: 'laminate', area_sqft: '300', area_unit: 'sq ft', city: 'buda',
        old_floor_removal: 'take the old floor away' } },
  });
  const priced = priceIt('p3');
  check('the order knows the old floor is coming out', priced.gathered.old_floor_removal, true);
  check('the catalogue and the removal rate are both there',
    [priced.gathered.bands.length > 0, 'old_floor_removal' in priced.gathered.rules], [true, true]);
  check('and still no price is allowed', priced.gathered.pricing_allowed, false);
  check('refused for the colour, not for anything missing',
    priced.quote.refusals, ['pricing_not_allowed', 'not_green']);
}

console.log('\nan order still missing its area is not priced');
{
  const a = arrive({
    id: 'p2', thread: 'th-p2', from: 'omar@example.com',
    text: 'i want carpet in the bedroom, kyle tx, size to follow',
    extracted: { intent: 'new_quote', material: 'carpet', city: 'kyle',
      evidence: { material: 'carpet', city: 'kyle' } },
  });
  const priced = priceIt('p2');
  check('no price was produced', priced.quote.priceable, false);
  check('and it says why, without guessing', priced.quote.refusals.includes('no_area'), true);
  check('nothing was written', priced.written, null);
  check('the order is where it was', orderOf(a.order_id).state, 'new');
  check('no offer exists for it', Number(ask(`SELECT count(*) FROM offers WHERE order_id = ${a.order_id}`)), 0);
}

console.log('\nthe same order priced a second time');
{
  const a = arrive({
    id: 'p4', thread: 'th-p4', from: 'mira@example.com',
    text: 'laminate, 500 sq ft, leander tx',
    extracted: { intent: 'new_quote', material: 'laminate', area_sqft: 500, area_unit: 'sqft',
      city: 'leander',
      evidence: { material: 'laminate', area_sqft: '500', area_unit: 'sq ft', city: 'leander' } },
  });
  const first = priceIt('p4');
  check('the first quote moved the order', first.written.order_moved, 't');

  const again = priceIt('p4');
  check('a second run writes a second offer', again.written.offer_id !== first.written.offer_id, true);
  check('the order does not move again', again.written.order_moved, 'f');
  check('and no second state change is recorded', Number(ask(
    `SELECT count(*) FROM order_events WHERE order_id = ${a.order_id} AND kind = 'state_change'`)), 1);
  check('the order is still quoted', orderOf(a.order_id).state, 'quoted');
}

console.log('\na material whose bands are all switched off in the spreadsheet');
{
  const a = arrive({
    id: 'p5', thread: 'th-p5', from: 'lena@example.com',
    text: 'sheet vinyl please, 220 sq ft, hutto tx',
    extracted: { intent: 'new_quote', material: 'vinyl', area_sqft: 220, area_unit: 'sqft', city: 'hutto',
      evidence: { material: 'vinyl', area_sqft: '220', area_unit: 'sq ft', city: 'hutto' } },
  });
  run(['-c', "UPDATE price_bands SET active = false WHERE category = 'Vinyl'"]);
  const priced = priceIt('p5');
  check('the catalogue offers nothing for it', priced.gathered.bands.length, 0);
  check('so no price is produced', priced.quote.priceable, false);
  check('and it says the catalogue is why', priced.quote.refusals.includes('no_price_band'), true);
  check('the order was not moved', orderOf(a.order_id).state, 'new');
  run(['-c', "UPDATE price_bands SET active = true WHERE category = 'Vinyl'"]);
}

console.log('\na message that never belonged to an order');
{
  arrive({
    id: 'p6', thread: 'th-p6', from: 'kai@example.com',
    text: 'thanks, that is all for now',
    extracted: { intent: 'follow_up', evidence: {} },
  });
  const priced = priceIt('p6');
  check('there is no order behind it', priced.gathered.order_id, null);
  check('no price is produced', priced.quote.priceable, false);
  check('and nothing was written', priced.written, null);
}

console.log('\nan order that has already been booked');
{
  const a = arrive({
    id: 'p7', thread: 'th-p7', from: 'jon@example.com',
    text: 'carpet, 260 sq ft, buda tx',
    extracted: { intent: 'new_quote', material: 'carpet', area_sqft: 260, area_unit: 'sqft', city: 'buda',
      evidence: { material: 'carpet', area_sqft: '260', area_unit: 'sq ft', city: 'buda' } },
  });
  run(['-c', `UPDATE orders SET state = 'booked', closed_at = now() WHERE id = ${a.order_id}`]);
  const priced = priceIt('p7');
  check('no offer is written against finished work', priced.written.offer_id, '');
  check('the booked order is untouched', orderOf(a.order_id).state, 'booked');
  check('and nothing was linked to the message', priced.written.message_linked, 'f');
}

console.log('\nnothing leaked between any of them');
{
  // not "one order per thread" — a thread whose job was booked may carry new work, and one
  // above does. The rule the unique index actually holds is that only one of them is open.
  check('no thread holds two open orders', Number(ask(
    "SELECT count(*) FROM (SELECT thread_id FROM orders"
    + " WHERE state NOT IN ('booked','done','lost') AND thread_id IS NOT NULL"
    + ' GROUP BY thread_id HAVING count(*) > 1) crowded')), 0);
  check('the only thread carrying two is the one whose first job was booked', JSON.parse(ask(
    "SELECT coalesce(json_agg(json_build_object('thread', thread_id, 'orders', n)), '[]'::json)"
    + ' FROM (SELECT thread_id, count(*) AS n FROM orders GROUP BY thread_id HAVING count(*) > 1) many')),
  [{ thread: 'th-t', orders: 2 }]);
  check('no order holds an area from a message the gate refused',
    Number(ask('SELECT count(*) FROM orders WHERE area_sqft >= 20000')), 0);
  check('every event names the message it came from',
    Number(ask('SELECT count(*) FROM order_events WHERE gmail_message_id IS NULL')), 0);
}

console.log(`\n${failed === 0 ? 'all checks passed' : `${failed} check(s) FAILED`}`);

try {
  execFileSync('psql', [url, '-q', '-c', 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;']);
} catch { /* the run already reported what matters */ }

process.exit(failed === 0 ? 0 : 1);
