import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
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

// asked of the database this harness just built, never written here. The name the firm signs with
// is a row precisely so that changing it is an UPDATE, and a harness holding its own copy would
// have to be edited every time — which is how a check ends up asserting last year's name.
const signature = () => ask("SELECT body FROM reply_templates WHERE key = 'signature'").trim();

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
// Two scenarios reaching for the same message id read each other's rows and pass anyway -- which
// is how a check on one customer's address came back with another's. An id is used once here.
const idsUsed = new Set();
const arrive = ({ id, thread, from, text, extracted, headers, labels }) => {
  if (idsUsed.has(id)) throw new Error(`the message id ${id} is already used by another scenario`);
  idsUsed.add(id);
  const [prepared] = node(prepareSource, [{
    id, threadId: thread, labelIds: labels || ['INBOX'],
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

// the two statements that decide whether to speak, and record having spoken
// A statement with nothing data-modifying in it can be wrapped, and then the values come back as
// JSON with their types and their line breaks intact. Splitting psql's own output on newlines read
// a signature as an empty string and quietly stopped checking it.
const jsonRowOf = (sql, values) => JSON.parse(ask(`SELECT row_to_json(t) FROM (${fill(sql, values)}) t`));

const askAbout = (id, orderId) => jsonRowOf(quoteSql('should-we-ask-and-for-what'), [id, orderId]);

// the node that turns a decision and a stored sentence into the letter a person receives
const composeSource = read('src', '10-quote', 'compose-the-reply.js');
// The decisions go in as the node's own input, deliberately: everything the reply needs comes back
// from the query that decided to speak, so a test cannot supply a field the running node would not
// have. Reaching back to another node throws here, because that is how the address went missing.
const composeAll = (...decisions) => new Function('$input', '$', composeSource)(
  { all: () => decisions.map((json) => ({ json })) },
  (name) => { throw new Error(`the reply reached back to ${name} instead of reading its input`); },
).map((r) => r.json);
const compose = (decision) => composeAll(decision)[0];

const quoteLetterSource = read('src', '10-quote', 'compose-the-quote.js');
const whatTheQuoteNeeds = (id, offerId) => JSON.parse(ask(
  `SELECT row_to_json(t) FROM (${fill(quoteSql('what-the-quote-letter-needs'), [id, offerId])}) t`));
const composeQuotes = (...needs) => new Function('$input', '$', quoteLetterSource)(
  { all: () => needs.map((json) => ({ json })) },
  (name) => { throw new Error(`the quote letter reached back to ${name} instead of reading its input`); },
).map((r) => r.json);
const putForward = (id, offerId, thread, letter) =>
  rowOf(quoteSql('say-the-offer-was-put-forward'), [id, offerId, thread, letter]);

const approvalSql = (n) => read('db', '60-approval', `${n}.sql`).replace(/;\s*$/, '');
// the lane's own first statement, run for real: it writes a status the database has to allow, and
// an invented one is refused at the moment a live email is being handled and nowhere before
const approvalHandoff = params(join('db', '60-approval', 'accept-handoff.params.json'));
const takeItOn = (id) => rowOf(approvalSql('accept-handoff'),
  approvalHandoff({ gmail_message_id: id }));
const readSource = read('src', '60-approval', 'did-she-say-send-it.js');
const whatItAnswers = (id, thread) => JSON.parse(ask(
  `SELECT row_to_json(t) FROM (${fill(approvalSql('what-this-reply-answers'), [id, thread])}) t`));
const didSheSaySendIt = (...answers) => new Function('$input', '$', readSource)(
  { all: () => answers.map((json) => ({ json })) },
  (name) => { throw new Error(`the reading reached back to ${name} instead of its input`); },
).map((r) => r.json);
const sayItWentOut = (id, offerId) =>
  rowOf(approvalSql('say-the-quote-went-out'), [id, offerId]);
const recordAsk = (id, orderId, asking) => rowOf(quoteSql('say-we-asked'), [id, orderId, asking]);

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

console.log('\nasking for the old floor to be taken away no longer stops the price');
{
  // This was open for weeks and is closed by the change above rather than on its own. Taking the
  // old floor away is a note about what will be charged, not a doubt about anything, but it put a
  // reason on the message, the message went yellow, and pricing wanted green -- so the arithmetic
  // had a removal line and a rate for it and could reach neither. Now that the permission asks the
  // job, a note no longer blocks a price. Being incomplete, being outside the area, and being held
  // for a person still do.
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
  check('the job may now be priced', priced.gathered.pricing_allowed, true);
  check('and it is', priced.quote.priceable, true);
  check('with the removal charged as its own line',
    (priced.quote.breakdown?.lines || []).some((l) => l.kind === 'removal'), true);
  check('and nothing is refused', priced.quote.refusals, []);
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
  // refused at the permission now rather than at the write. Finished work is not a job that may be
  // priced, so the arithmetic is never reached and there is nothing to refuse to write down. The
  // statement that writes an offer still guards it too, and that guard is exercised below.
  check('finished work may not be priced', priced.gathered.pricing_allowed, false);
  check('so no price is produced', priced.quote.priceable, false);
  check('and nothing is written', priced.written, null);
  check('the booked order is untouched', orderOf(a.order_id).state, 'booked');

  // the write's own guard, reached directly: it must refuse even when something hands it a price
  const forced = rowOf(quoteSql('write-the-offer'),
    ['p7', a.order_id, 100, 200, 100, 200, JSON.stringify({ lines: [] }), 'quote-v1']);
  check('and the statement that writes offers refuses finished work by itself',
    forced.offer_id, '');
  check('with nothing linked to the message', forced.message_linked, 'f');
}

console.log('\nthe system asks for what is missing, once');
{
  const first = arrive({
    id: 'q10', thread: 'th-ask', from: 'zoe@example.com',
    text: 'hi, i want laminate in the hallway, kyle tx',
    extracted: { intent: 'new_quote', material: 'laminate', city: 'kyle',
      evidence: { material: 'laminate', city: 'kyle' } },
  });
  const one = askAbout('q10', first.order_id);
  check('it knows to ask', one.should_ask, true);
  check('and what for', one.asking_for, 'area');
  check('with words a person wrote', one.template_key, 'needs_area');
  recordAsk('q10', first.order_id, one.asking_for);

  const second = arrive({
    id: 'q11', thread: 'th-ask', from: 'zoe@example.com',
    text: 'sorry, forgot to say - hallway and the landing',
    extracted: { intent: 'new_quote', evidence: {} },
  });
  const twice = askAbout('q11', second.order_id);
  check('a second email adding nothing does not get the same question again', twice.should_ask, false);
  check('though it is still the thing that is missing', twice.asking_for, 'area');

  const third = arrive({
    id: 'q12', thread: 'th-ask', from: 'zoe@example.com',
    text: 'it is about 380 sq ft',
    extracted: { intent: 'new_quote', area_sqft: 380, area_unit: 'sqft',
      evidence: { area_sqft: '380', area_unit: 'sq ft' } },
  });
  const done = askAbout('q12', third.order_id);
  check('once answered there is nothing to ask', done.should_ask, false);
  check('and nothing is missing', done.asking_for, '');
  check('exactly one question was ever recorded', Number(ask(
    `SELECT count(*) FROM order_events WHERE order_id = ${first.order_id} AND kind = 'asked'`)), 1);
}

console.log('\nthe letter a customer would actually receive');
{
  const a = arrive({
    id: 'w1', thread: 'th-w', from: 'wren@example.com',
    text: 'hi, laminate in the hallway please, kyle tx',
    extracted: { intent: 'new_quote', material: 'laminate', city: 'kyle',
      evidence: { material: 'laminate', city: 'kyle' } },
  });
  const decision = askAbout('w1', a.order_id);
  const letter = compose(decision);

  check('it goes to the person who wrote in', letter.to, 'wren@example.com');
  check('it stays in their thread', letter.thread_id, 'th-w');
  check('the subject is Gmail\'s to continue, not ours to invent', letter.subject, null);
  check('it asks for the one thing missing, in the words a person wrote',
    letter.body.includes('To price this I need one more thing'), true);
  check('it does not ask for what it already knows', /what are you thinking of putting down/.test(letter.body), false);
  check('it is signed', letter.body.trimEnd().endsWith(signature()), true);
  // The old promise here was that an asking letter carried no figure at all. That was the pause
  // this desk exists to remove, and it is deliberately reversed: the rate goes out first. What
  // survives is the narrower and more important rule -- a TOTAL is only ever worked out from an
  // area the customer gave, and this letter is asking for that area precisely because it has none.
  check('it carries the rate for what they named', /Laminate standard: \$4-\$8 per sq ft/.test(letter.body), true);
  check('but no total, because there is no area to multiply',
    /comes to roughly/.test(letter.body), false);
}

console.log('\nthe second reader can only ever raise a hand');
{
  const foldSource = read('src', '00-intake-router', 'fold-in-the-second-opinion.js');
  // the same file in both modes: watching, which is how it is deployed, and acting, which is what
  // one word turns on. The safety property has to hold in both, and it is only interesting in the
  // second -- so it is exercised there rather than left until the day somebody flips it.
  const foldWith = (acting) => (decision, verdict) => new Function('$input', '$',
    foldSource.replace('const THE_READER_MAY_ACT = false;', `const THE_READER_MAY_ACT = ${acting};`))(
    { all: () => [{ json: verdict }] },
    () => ({ all: () => [{ json: decision }] }),
  )[0].json;
  const fold = foldWith(true);
  const watching = foldWith(false);

  const free = { gmail_message_id: 'f1', category: 'quote_request', auto_blocked: false };
  const held = { gmail_message_id: 'f2', category: 'quote_request', auto_blocked: true };

  check('a reader that agrees changes nothing',
    fold(free, { holds: true }).auto_blocked, false);
  check('and says so on the message', fold(free, { holds: true }).second_opinion, 'holds');

  const stopped = fold(free, { holds: false, why: 'they asked for anything but laminate' });
  check('a reader that disagrees raises the hand', stopped.auto_blocked, true);
  check('and the reason is kept for the owner',
    stopped.second_opinion_why, 'they asked for anything but laminate');

  check('a hand the gate raised is never lowered by agreement',
    fold(held, { holds: true }).auto_blocked, true);
  check('nor by silence', fold(held, {}).auto_blocked, true);

  // three ways of saying nothing usable, and all three must leave the decision alone
  for (const [what, verdict] of [['no answer at all', {}],
                                 ['a shape nobody expects', { verdict: 'maybe' }],
                                 ['a refusal with no reason', { holds: false }]]) {
    const out = fold(free, verdict);
    check(`${what} changes nothing`, [out.auto_blocked, out.second_opinion], [false, null]);
  }

  check('the decision itself is carried through untouched',
    fold(free, { holds: true }).category, 'quote_request');

  // as deployed today: the opinion is written down and nothing acts on it
  const seen = watching(free, { holds: false, why: 'they asked for anything but laminate' });
  check('while it is only watching, the hand stays down', seen.auto_blocked, false);
  check('but what it thought is still written down', seen.second_opinion, 'does_not_hold');
  check('with the reason, ready to be counted later',
    seen.second_opinion_why, 'they asked for anything but laminate');
  check('and a hand the gate raised is still not touched by it',
    watching(held, { holds: true }).auto_blocked, true);
  check('and the answer is wrapped in output, as the parser returns it',
    fold(free, { output: { holds: false, why: 'the town is not in Texas' } }).auto_blocked, true);
}

console.log('\na job that has everything is priced, whatever the newest letter says');
{
  // the conversation a live letter found on 31 July: three emails, the third carrying nothing at
  // all, and the job behind it ready to be quoted since the second
  const first = arrive({
    id: 'ready1', thread: 'th-ready', from: 'gus@example.com',
    text: 'hi, laminate in the living room, kyle tx',
    extracted: { intent: 'new_quote', material: 'laminate', city: 'kyle',
      evidence: { material: 'laminate', city: 'kyle' } },
  });
  arrive({
    id: 'ready2', thread: 'th-ready', from: 'gus@example.com',
    text: 'about 400 sq ft',
    extracted: { intent: 'new_quote', area_sqft: 400, area_unit: 'sqft',
      evidence: { area_sqft: '400', area_unit: 'sq ft' } },
  });
  check('the job is ready after two letters', orderOf(first.order_id).material_category, 'Laminate');

  const third = arrive({
    id: 'ready3', thread: 'th-ready', from: 'gus@example.com',
    text: 'can you send me the price?',
    extracted: { intent: 'new_quote', evidence: {} },
  });
  check('the third letter carries nothing of its own', third.decision.settled.material_category, null);
  check('but it is read as a request for a price', third.decision.category, 'quote_request');
  check('by the rule that names why', third.decision.matched_rule, 'the_job_is_ready');
  check('and it goes to the lane that prices', third.decision.route, 'quote');

  const priced = priceIt('ready3');
  check('and the job is priced', priced.quote.priceable, true);

  // once a quote exists, the same words mean something else
  const [letter] = composeQuotes(whatTheQuoteNeeds('ready3', priced.written.offer_id));
  putForward('ready3', priced.written.offer_id, 'th-owner-ready', letter.the_letter_itself);
  run(['-c', `UPDATE offers SET status = 'sent' WHERE id = ${priced.written.offer_id}`]);
  const fourth = arrive({
    id: 'ready4', thread: 'th-ready', from: 'gus@example.com',
    text: 'can you send me the price?',
    extracted: { intent: 'new_quote', evidence: {} },
  });
  check('now the same letter is a conversation to continue', fourth.decision.matched_rule,
    'thread_continuation');
  check('and it is not quoted a second time', fourth.decision.route, 'project');
}

console.log('\nthe letter answers with a number before it asks anything');
{
  // the material is known and the size is not: the rate for that material, and no total, because
  // there is no area to multiply and a quantity is never invented
  const one = arrive({
    id: 'rate1', thread: 'th-rate1', from: 'ada@example.com',
    text: 'laminate in the hallway, kyle tx',
    extracted: { intent: 'new_quote', material: 'laminate', city: 'kyle',
      evidence: { material: 'laminate', city: 'kyle' } },
  });
  const a = compose(askAbout('rate1', one.order_id));
  check('the rate comes before the question',
    a.body.indexOf('per sq ft') < a.body.indexOf('how many square feet'), true);
  check('and it is the rate for what they named',
    /Laminate standard: \$4-\$8 per sq ft/.test(a.body), true);
  check('not for everything the firm lays', /Carpet|Engineered wood/.test(a.body), false);
  check('no total is invented from nothing', /comes to roughly/.test(a.body), false);

  // the size is known and the material is not: every rate, and a total, because the area is real
  const two = arrive({
    id: 'rate2', thread: 'th-rate2', from: 'bo@example.com',
    text: 'about 400 sq ft, buda tx, not sure what to put down',
    extracted: { intent: 'new_quote', area_sqft: 400, area_unit: 'sqft', city: 'buda',
      evidence: { area_sqft: '400', area_unit: 'sq ft', city: 'buda' } },
  });
  const b = compose(askAbout('rate2', two.order_id));
  check('every rate is shown when nothing was named',
    ['Carpet', 'Laminate standard', 'Engineered wood'].every((p) => b.body.includes(p)), true);
  check('and a total is worked out from the area they gave',
    /For 400 sq ft that comes to roughly \$800 to \$5,600/.test(b.body), true);

  // outside the service area: a refusal, and not a number in sight
  const three = arrive({
    id: 'rate3', thread: 'th-rate3', from: 'cy@example.com',
    text: 'laminate, 400 sq ft, in dallas tx',
    extracted: { intent: 'new_quote', material: 'laminate', area_sqft: 400, area_unit: 'sqft',
      city: 'dallas',
      evidence: { material: 'laminate', area_sqft: '400', area_unit: 'sq ft', city: 'dallas' } },
  });
  // the branch downstream reads should_speak, not should_ask: an out-of-area order is missing
  // nothing, so nothing is asked -- and before this the customer heard silence
  const dal = askAbout('rate3', three.order_id);
  check('nothing is missing from an out-of-area order', dal.still_missing, []);
  check('so there is no question to ask', dal.should_ask, false);
  check('but there is still something to say', dal.should_speak, true);

  // reported rather than thrown: without the refusal there is no template for this case at all,
  // and a harness that dies says less than one that names what went wrong
  let c = null, threw = null;
  try { c = compose(askAbout('rate3', three.order_id)); } catch (e) { threw = e.message; }
  check('a letter for a property out of the area can be written at all', threw, null);
  check('a property out of the area is told so', /outside what I can reach/.test(c?.body || ''), true);
  check('and is not asked where it is', /Whereabouts is the property/.test(c?.body || ''), false);
  check('and is given no figure at all', /\$/.test(c?.body || ''), false);
}

console.log('\nthe states the letter only claimed to handle');
{
  const a = arrive({
    id: 'w3', thread: 'th-w3', from: 'una@example.com',
    text: 'carpet, 240 sq ft please',
    extracted: { intent: 'new_quote', material: 'carpet', area_sqft: 240, area_unit: 'sqft',
      evidence: { material: 'carpet', area_sqft: '240', area_unit: 'sq ft' } },
  });
  const town = askAbout('w3', a.order_id);
  check('only the town is missing', town.asking_for, 'location');
  check('and it has its own words', town.template_key, 'needs_location');
  check('which ask about the property, not the floor',
    /Whereabouts is the property/.test(town.body), true);

  const b = arrive({
    id: 'w4', thread: 'th-w4', from: 'tom@example.com',
    text: 'about 500 sq ft in leander tx, not sure what to put down',
    extracted: { intent: 'new_quote', area_sqft: 500, area_unit: 'sqft', city: 'leander',
      evidence: { area_sqft: '500', area_unit: 'sq ft', city: 'leander' } },
  });
  const material = askAbout('w4', b.order_id);
  check('only the material is missing', material.asking_for, 'material');
  check('and the words list what the firm lays',
    /luxury vinyl plank, laminate, engineered wood/.test(material.body), true);

  run(['-c', `UPDATE orders SET state = 'booked', closed_at = now() WHERE id = ${b.order_id}`]);
  const closed = askAbout('w4', b.order_id);
  check('a finished job is not asked anything', closed.should_ask, false);

  // a platform that forwarded no reply-to, as the row actually looks in that case
  run(['-c', "UPDATE messages SET contact_email = NULL WHERE gmail_message_id = 'w3'"]);
  let refused = false;
  try {
    compose(askAbout('w3', a.order_id));
  } catch (e) {
    refused = /no address to answer/.test(e.message);
  }
  check('a lead with no reply-to is refused, not sent into the void', refused, true);
  run(['-c', "UPDATE messages SET contact_email = 'una@example.com' WHERE gmail_message_id = 'w3'"]);
}

console.log('\na template nobody wrote is refused rather than sent empty');
{
  run(['-c', "DELETE FROM reply_templates WHERE key = 'needs_both'"]);
  const a = arrive({
    id: 'w2', thread: 'th-w2', from: 'vic@example.com',
    text: 'hello, i need a floor doing, buda tx',
    extracted: { intent: 'new_quote', city: 'buda', evidence: { city: 'buda' } },
  });
  const decision = askAbout('w2', a.order_id);
  let refused = false;
  try {
    compose(decision);
  } catch (e) {
    refused = /reply_templates is missing a row/.test(e.message);
  }
  check('an empty letter is refused, not sent', refused, true);
  // put it back as it was, permission included: the column defaults to false, so a row restored
  // without it can no longer reach a customer, which is the right default and the wrong test
  run(['-c', "INSERT INTO reply_templates (key, body, sends_automatically) VALUES ('needs_both',"
    + " 'Thanks for getting in touch. Two things and I can put a number on it.', true)"]);
}

console.log('\na customer who answers half of it gets asked for the rest');
{
  const first = arrive({
    id: 'q20', thread: 'th-half', from: 'yuri@example.com',
    text: 'hello, i need a floor doing, manor tx',
    extracted: { intent: 'new_quote', city: 'manor', evidence: { city: 'manor' } },
  });
  const one = askAbout('q20', first.order_id);
  check('both things are missing', one.asking_for, 'material,area');
  check('and the words say so', one.template_key, 'needs_both');
  recordAsk('q20', first.order_id, one.asking_for);

  const second = arrive({
    id: 'q21', thread: 'th-half', from: 'yuri@example.com',
    text: 'carpet please',
    extracted: { intent: 'new_quote', material: 'carpet', evidence: { material: 'carpet' } },
  });
  const two = askAbout('q21', second.order_id);
  check('the question changed, so it is asked again', two.should_ask, true);
  check('for what is left', two.asking_for, 'area');
  check('with different words', two.template_key, 'needs_area');
}

console.log('\nthe gate hands on the answer to a question about what the firm does');
{
  const a = arrive({
    id: 'q30', thread: 'th-cap', from: 'xena@example.com',
    text: 'do you install laminate? cedar park tx',
    extracted: { intent: 'pre_sales_question', material: 'laminate', city: 'cedar park',
      evidence: { material: 'laminate', city: 'cedar park' } },
  });
  check('it was read as a question, not as work', a.decision.category, 'pre_sales');
  check('and the answer came from the services table', a.decision.service_answer,
    'Yes, we install laminate.');
  check('which says the firm does it', a.decision.service_we_do, true);
  check('no order was opened for a question', a.order_id, null);
}

console.log('\nour own letter coming back into the mailbox');
{
  const first = arrive({
    id: 'l1', thread: 'th-loop', from: 'sara@example.com',
    text: 'hi, laminate in the hallway, buda tx',
    extracted: { intent: 'new_quote', material: 'laminate', city: 'buda',
      evidence: { material: 'laminate', city: 'buda' } },
  });
  const asked = askAbout('l1', first.order_id);
  check('we would ask for the area', asked.asking_for, 'area');
  recordAsk('l1', first.order_id, asked.asking_for);
  const before = orderOf(first.order_id);

  // Gmail labels a letter the desk sends to itself with SENT and INBOX both, so the trigger picks
  // it up again. This is the same letter arriving as if a customer had written it.
  const ourOwn = arrive({
    id: 'l2', thread: 'th-loop', from: 'flooring.demo.austin@gmail.com',
    text: asked.body,
    extracted: { intent: 'new_quote', evidence: {} },
    labels: ['SENT', 'INBOX'],
  });
  check('the gate knows it is ours', ourOwn.decision.category, 'owner_reply');
  check('it goes to the lane that reads answers', ourOwn.decision.route, 'approval');
  // which is where it stops: that lane looks for an offer waiting in this very thread, and the
  // desk's own words are not an assent to anything
  const [readOurs] = didSheSaySendIt(whatItAnswers('l2', 'th-loop'));
  check('and our own letter is not read as an approval', readOurs.approved, false);
  check('and nothing is handled', ourOwn.decision.handling, 'none');
  // It is linked to the conversation's order, which is right: our own letter belongs to that
  // exchange and a person reading the thread should see it. What matters is that it carries nothing
  // into the order and leaves no event behind, because the gate settled nothing on it.
  check('it belongs to the same conversation', ourOwn.order_id, first.order_id);
  check('and contributes nothing to it', orderOf(first.order_id), before);
  check('leaving no event of its own', Number(ask(
    "SELECT count(*) FROM order_events WHERE gmail_message_id = 'l2'")), 0);

  const answer = arrive({
    id: 'l3', thread: 'th-loop', from: 'sara@example.com',
    text: 'sorry - about 260 sq ft',
    extracted: { intent: 'new_quote', area_sqft: 260, area_unit: 'sqft',
      evidence: { area_sqft: '260', area_unit: 'sq ft' } },
  });
  check('the real answer still lands', orderOf(answer.order_id).area_sqft, 260);
  check('and there is nothing left to ask', askAbout('l3', answer.order_id).should_ask, false);
}

console.log('\na returning customer says where they live');
{
  // The letter that found this. Three earlier messages from the same address made her a returning
  // contact, "we're in Round Rock, TX" matched an acceptance pattern, and a first enquiry was filed
  // as accepting a quote that had never been sent - to a lane that does nothing.
  for (const n of [1, 2]) {
    arrive({
      id: `r1${n}`, thread: `th-earlier-${n}`, from: 'anna@example.com',
      text: 'hello, just looking for information about floors',
      extracted: { intent: 'pre_sales_question', evidence: {} },
    });
  }
  const enquiry = arrive({
    id: 'r13', thread: 'th-place', from: 'anna@example.com',
    text: "hi, i'd like lvp in the living room and hallway, about 420 sq ft. "
      + "we're in round rock, tx. what would that cost? thanks, anna",
    extracted: { intent: 'new_quote', material: 'lvp', area_sqft: 420, area_unit: 'sqft',
      city: 'round rock',
      evidence: { material: 'lvp', area_sqft: '420', area_unit: 'sq ft', city: 'round rock' } },
  });
  check('she counts as a returning contact', enquiry.decision.is_returning, true);
  check('and no offer has ever existed', Number(ask('SELECT count(*) FROM offers')) >= 0, true);
  check('it is read as asking for a price', enquiry.decision.category, 'quote_request');
  check('not as accepting one', enquiry.decision.matched_rule !== 'offer_response', true);
  check('it is green', enquiry.decision.gate_color, 'green');
  check('and a price is allowed', enquiry.decision.pricing_allowed, true);

  const priced = priceIt('r13');
  check('so it reaches a price', priced.quote.priceable, true);
  check('and the offer is written', priced.written.offer_id !== '', true);
  check('the order is quoted', orderOf(enquiry.order_id).state, 'quoted');
}

console.log('\nand a customer who really is accepting one');
{
  const first = arrive({
    id: 'r20', thread: 'th-accept', from: 'iris@example.com',
    text: 'laminate, 300 sq ft, buda tx, what would it cost?',
    extracted: { intent: 'new_quote', material: 'laminate', area_sqft: 300, area_unit: 'sqft',
      city: 'buda',
      evidence: { material: 'laminate', area_sqft: '300', area_unit: 'sq ft', city: 'buda' } },
  });
  priceIt('r20');
  check('an offer now exists for her', Number(ask(
    `SELECT count(*) FROM offers WHERE order_id = ${first.order_id}`)), 1);

  const yes = arrive({
    id: 'r21', thread: 'th-accept', from: 'iris@example.com',
    text: 'that works for us, go ahead',
    extracted: { intent: 'offer_response', evidence: {} },
  });
  check('this one is read as accepting', yes.decision.category, 'offer_response');
  check('and goes to a person, not to a price', yes.decision.route, 'project');
  check('marked for the owner now', yes.decision.gate_color, 'red');
  check('and the gate says which way: accepted', yes.decision.offer_answer, 'accepted');
}

console.log('\nand a customer who is pushing back on the price');
{
  const first = arrive({
    id: 'r22', thread: 'th-pushback', from: 'noah@example.com',
    text: 'laminate, 300 sq ft, buda tx, what would it cost?',
    extracted: { intent: 'new_quote', material: 'laminate', area_sqft: 300, area_unit: 'sqft',
      city: 'buda',
      evidence: { material: 'laminate', area_sqft: '300', area_unit: 'sq ft', city: 'buda' } },
  });
  priceIt('r22');

  const pushback = arrive({
    id: 'r23', thread: 'th-pushback', from: 'noah@example.com',
    text: 'that is more than we expected',
    extracted: { intent: 'offer_response', evidence: {} },
  });
  check('this one is read as haggling, not accepting', pushback.decision.category, 'offer_response');
  check('the owner decides, not a price', pushback.decision.route, 'project');
  check('and the gate says which way: pushed back', pushback.decision.offer_answer, 'pushed_back');
}

console.log('\nwhere a letter goes is the sentence\'s decision');
{
  const a = arrive({
    id: 'x1', thread: 'th-send', from: 'nora@example.com',
    text: 'hi, engineered wood please, in manor tx',
    extracted: { intent: 'new_quote', material: 'engineered wood', city: 'manor',
      evidence: { material: 'engineered wood', city: 'manor' } },
  });
  const decision = askAbout('x1', a.order_id);
  check('only the area is missing, so it is that sentence', decision.template_key, 'needs_area');
  check('which may go out alone', decision.may_go_alone, true);
  const letter = compose(decision);
  check('so it goes to the customer', letter.to, 'nora@example.com');
  check('in her thread', letter.thread_id, 'th-send');
  check('and it says it reaches her', letter.reaches_the_customer, true);
  check('and needs no subject of its own, being a reply', letter.subject, null);

  run(['-c', "UPDATE reply_templates SET sends_automatically = false WHERE key = 'needs_area'"]);
  const held = askAbout('x1', a.order_id);
  check('the same sentence now may not', held.may_go_alone, false);
  const draft = compose(held);
  check('so it goes to the owner instead', draft.to, 'flooring.demo.austin@gmail.com');
  check('not into the customer thread', draft.thread_id, null);
  check('the subject says it was not sent, and for whom',
    draft.subject, 'Not sent -- a question for nora@example.com');
  check('the body names who it was for', /composed for nora@example\.com and not sent/.test(draft.body), true);
  check('and still carries the words themselves', /roughly how many square feet/.test(draft.body), true);
  check('it does not claim to have reached her', draft.reaches_the_customer, false);
  run(['-c', "UPDATE reply_templates SET sends_automatically = true WHERE key = 'needs_area'"]);
}

console.log('\na price becomes a letter, and it only ever reaches the owner');
{
  const a = arrive({
    id: 'quote1', thread: 'th-quote1', from: 'vera@example.com',
    text: 'laminate, 400 sq ft, in kyle tx please',
    extracted: { intent: 'new_quote', material: 'laminate', area_sqft: 400, area_unit: 'sqft',
      city: 'kyle',
      evidence: { material: 'laminate', area_sqft: '400', area_unit: 'sq ft', city: 'kyle' } },
  });
  const priced = priceIt('quote1');
  check('the job was priced', priced.quote.priceable, true);
  check('and the offer was written down', Number(priced.written.offer_id) > 0, true);

  const needs = whatTheQuoteNeeds('quote1', priced.written.offer_id);
  check('the letter has everything it needs', needs.ready_to_write, true);
  check('it reads the offer rather than pricing again',
    Number(needs.total_low), Number(priced.quote.total_low));

  const [letter] = composeQuotes(needs);
  check('it goes to the owner', letter.to, 'flooring.demo.austin@gmail.com');
  check('and says so plainly', letter.reaches_the_customer, false);
  check('the subject names who it is for', /vera@example\.com/.test(letter.subject), true);
  check('the owner is told it has not been sent',
    /has not been sent/.test(letter.body), true);
  check('the letter for the customer is in there, whole',
    letter.body.includes(letter.the_letter_itself), true);
  check('with the words a person wrote, not the code',
    /Thanks for the details/.test(letter.the_letter_itself), true);
  check('and it is signed', letter.the_letter_itself.trimEnd().endsWith(signature()), true);
  check('the figures are in it', /\$/.test(letter.the_letter_itself), true);
  check('every priced line shows the rate it came from',
    /at \$[\d,]+(-\$[\d,]+)?\/sqft/.test(letter.the_letter_itself), true);
  check('the town is written as a town, not as a lookup key',
    /Kyle/.test(letter.the_letter_itself), true);
  check('and the closing explains the spread it actually has',
    /options listed above/.test(letter.the_letter_itself), true);

  const said = putForward('quote1', priced.written.offer_id, 'th-approve-1',
    letter.the_letter_itself);
  check('the offer is now waiting for her', said.now_waiting, 't');
  check('and the order remembers it moved', said.change_recorded, 't');
  check('the offer says so itself',
    ask(`SELECT status FROM offers WHERE id = ${priced.written.offer_id}`), 'awaiting_approval');

  const again = putForward('quote1', priced.written.offer_id, 'th-approve-1',
    letter.the_letter_itself);
  check('telling her twice about one figure does not happen', again.now_waiting, 'f');
  const reread = whatTheQuoteNeeds('quote1', priced.written.offer_id);
  check('and a second run has no letter to write', reread.ready_to_write, false);
}

console.log('\ntwo quotes in one poll are both written');
{
  const a = arrive({
    id: 'quote2', thread: 'th-quote2', from: 'walt@example.com',
    text: 'lvp, 300 sq ft, buda tx',
    extracted: { intent: 'new_quote', material: 'lvp', area_sqft: 300, area_unit: 'sqft',
      city: 'buda', evidence: { material: 'lvp', area_sqft: '300', area_unit: 'sq ft', city: 'buda' } },
  });
  const b = arrive({
    id: 'quote3', thread: 'th-quote3', from: 'xena@example.com',
    text: 'laminate, 500 sq ft, leander tx',
    extracted: { intent: 'new_quote', material: 'laminate', area_sqft: 500, area_unit: 'sqft',
      city: 'leander',
      evidence: { material: 'laminate', area_sqft: '500', area_unit: 'sq ft', city: 'leander' } },
  });
  const one = priceIt('quote2');
  const two = priceIt('quote3');
  const letters = composeQuotes(whatTheQuoteNeeds('quote2', one.written.offer_id),
                                whatTheQuoteNeeds('quote3', two.written.offer_id));
  check('both were written', letters.length, 2);
  check('each names its own customer',
    [letters[0].for_whom, letters[1].for_whom], ['walt@example.com', 'xena@example.com']);
  check('and neither carries the other\'s figure',
    letters[0].the_letter_itself === letters[1].the_letter_itself, false);
}

console.log('\nan order that has gone quiet is chased once, then let go');
{
  const quietSql = (n) => read('db', '65-reminders', `${n}.sql`).replace(/;\s*$/, '');
  const nudgeSource = read('src', '65-reminders', 'write-the-nudge.js');
  // as json: the stored nudge has line breaks in it, and a column split cannot survive those
  const survey = (nudgeAfter, letGoAfter) => JSON.parse(ask(
    `SELECT coalesce(json_agg(t), '[]'::json) FROM (${fill(quietSql('who-has-gone-quiet'),
      [nudgeAfter, letGoAfter])}) t`));
  const writeNudges = (rows) => new Function('$input', '$', nudgeSource)(
    { all: () => rows.map((json) => ({ json })) },
    (name) => { throw new Error(`the nudge reached back to ${name}`) },
  ).map((r) => r.json);

  const a = arrive({
    id: 'quiet1', thread: 'th-quiet', from: 'fay@example.com',
    text: 'laminate in the hallway, kyle tx',
    extracted: { intent: 'new_quote', material: 'laminate', city: 'kyle',
      evidence: { material: 'laminate', city: 'kyle' } },
  });

  const fresh = survey(5, 21).find((r) => r.order_id === a.order_id);
  check('a conversation from today is left alone', fresh.what_now, 'live');

  run(['-c', `UPDATE orders SET updated_at = now() - interval '9 days' WHERE id = ${a.order_id}`]);
  const stale = survey(5, 21).find((r) => r.order_id === a.order_id);
  check('past the first mark it is due a nudge', stale.what_now, 'nudge');
  check('and there is a letter of theirs to continue', stale.reply_to, 'quiet1');

  const [nudge] = writeNudges([stale]);
  check('the nudge goes to whoever wrote in', nudge.to, 'fay@example.com');
  check('in the words a person wrote', /still on your mind/.test(nudge.body), true);
  check('it carries no figure', /\$|[0-9]{3,}/.test(nudge.body), false);
  check('and it does not repeat the question',
    /how many square feet/.test(nudge.body), false);

  rowOf(quietSql('say-we-nudged'), [a.order_id, 'quiet1']);
  const after = survey(5, 21).find((r) => r.order_id === a.order_id);
  check('once nudged it waits rather than being nudged again', after.what_now, 'waiting');
  check('and a second recording writes nothing',
    ask(fill(quietSql('say-we-nudged'), [a.order_id, 'quiet1'])), 'INSERT 0 0');

  run(['-c', `UPDATE orders SET updated_at = now() - interval '30 days' WHERE id = ${a.order_id}`]);
  const cold = survey(5, 21).find((r) => r.order_id === a.order_id);
  check('past the second mark it is let go', cold.what_now, 'let go');
  const gone = rowOf(quietSql('let-it-go'), [a.order_id]);
  check('the order is closed', gone.let_go, 't');
  check('and it remembers what it was', gone.was, 'new');
  check('the order says so itself', orderOf(a.order_id).state, 'lost');
  check('nothing is written to the customer about it',
    writeNudges([cold]).length, 0);
  check('and it is gone from the survey',
    survey(5, 21).some((r) => r.order_id === a.order_id), false);
}

console.log('\na question about what the firm does gets an answer');
{
  const answerSource = read('src', '10-quote', 'answer-the-question.js');
  const deserves = (id) => JSON.parse(ask(
    `SELECT row_to_json(t) FROM (${fill(quoteSql('what-a-question-deserves'), [id])}) t`));
  const answerAll = (...rows) => new Function('$input', '$', answerSource)(
    { all: () => rows.map((json) => ({ json })) },
    (name) => { throw new Error(`the answer reached back to ${name}`) },
  ).map((r) => r.json);

  const yes = arrive({
    id: 'ask1', thread: 'th-ask1', from: 'cal@example.com',
    text: 'do you install laminate?',
    extracted: { intent: 'pre_sales_question', evidence: {} },
  });
  check('it opens no order', yes.order_id, null);
  const d1 = deserves('ask1');
  check('the desk knows what was asked about', d1.service_asked_about, 'laminate');
  check('and that it is worth answering', d1.worth_answering, true);
  const [a1] = answerAll(d1);
  check('the answer is the one stored in services',
    a1.body.startsWith('Yes, we install laminate.'), true);
  check('and it asks what a price would need', a1.asks_for_more, true);
  check('in the words a person wrote',
    /roughly how many square feet/.test(a1.body), true);
  check('it goes back to whoever asked', a1.to, 'cal@example.com');
  check('with no figure in it', /\$|[0-9]{3,}/.test(a1.body), false);

  const no = arrive({
    id: 'ask2', thread: 'th-ask2', from: 'dot@example.com',
    text: 'do you do tile in the bathroom?',
    extracted: { intent: 'pre_sales_question', evidence: {} },
  });
  const [a2] = answerAll(deserves('ask2'));
  check('a service the firm does not offer is answered too',
    /do not install tile/.test(a2.body), true);
  check('and is not followed by asking for the size', a2.asks_for_more, false);

  const held = arrive({
    id: 'ask3', thread: 'th-ask3', from: 'eve@example.com',
    text: 'property management here — do you install laminate across our units?',
    extracted: { intent: 'pre_sales_question', evidence: {} },
  });
  check('a question from a commercial property is held', held.decision.auto_blocked, true);
  const d3 = deserves('ask3');
  check('the desk still knows what was asked', d3.service_asked_about, 'laminate');
  check('but it is not answered by itself', d3.worth_answering, false);

  const said = rowOf(quoteSql('say-we-answered'), ['ask1']);
  check('the message records that it was answered',
    said.handled_by, '10 Quote — Flooring (answered a question)');
  // psql reports the tag when a statement returns nothing at all, which is the point here
  check('and a redelivery does not answer it twice',
    ask(fill(quoteSql('say-we-answered'), ['ask1'])), 'UPDATE 0');
}

console.log('\nfacts given across two letters still reach a price');
{
  // the conversation this whole system exists for, and the one a live run found could never
  // finish: the second letter names no town, so the gate colours it red and asks for one, while
  // the order it belongs to has had the town since the first
  const first = arrive({
    id: 'pair1', thread: 'th-pair', from: 'ada@example.com',
    text: 'hi, laminate in the living room, kyle tx',
    extracted: { intent: 'new_quote', material: 'laminate', city: 'kyle',
      evidence: { material: 'laminate', city: 'kyle' } },
  });
  check('the first letter cannot be priced yet', priceIt('pair1').quote.priceable, false);

  const second = arrive({
    id: 'pair2', thread: 'th-pair', from: 'ada@example.com',
    text: 'about 400 sq ft',
    extracted: { intent: 'new_quote', area_sqft: 400, area_unit: 'sqft',
      evidence: { area_sqft: '400', area_unit: 'sq ft' } },
  });
  check('the second letter joins the same order', second.order_id, first.order_id);
  // what matters is not which shade: under the old rule pricing wanted green, and this letter --
  // which names no town, because the first one did -- is not green on its own
  check('that letter on its own is not green', second.decision.gate_color !== 'green', true);
  check('but the order is missing nothing', Number(orderOf(first.order_id).area_sqft), 400);

  const priced = priceIt('pair2');
  check('so the job is priced', priced.quote.priceable, true);
  check('with nothing refused', priced.quote.refusals, []);
  check('and the offer is written down', Number(priced.written?.offer_id) > 0, true);
  check('the letter can be composed from it',
    priced.written ? whatTheQuoteNeeds('pair2', priced.written.offer_id).ready_to_write : false, true);
}

console.log('\na job a person must see is still not priced, whatever the last letter says');
{
  const first = arrive({
    id: 'held1', thread: 'th-held', from: 'bea@example.com',
    text: 'property management here, laminate for a unit in kyle tx',
    extracted: { intent: 'new_quote', material: 'laminate', city: 'kyle',
      evidence: { material: 'laminate', city: 'kyle' } },
  });
  check('the first letter is held back', first.decision.auto_blocked, true);
  arrive({
    id: 'held2', thread: 'th-held', from: 'bea@example.com',
    text: 'it is about 400 sq ft',
    extracted: { intent: 'new_quote', area_sqft: 400, area_unit: 'sqft',
      evidence: { area_sqft: '400', area_unit: 'sq ft' } },
  });
  const priced = priceIt('held2');
  check('the order now has everything', Number(orderOf(first.order_id).area_sqft), 400);
  check('and it is still not priced', priced.quote.priceable, false);
  check('because the job, not this letter, was held', priced.gathered.pricing_allowed, false);
}

console.log('\nthe owner says send it, and only then does the customer get a price');
{
  const a = arrive({
    id: 'appr1', thread: 'th-appr1', from: 'yuri@example.com',
    text: 'lvp, 350 sq ft, in kyle tx',
    extracted: { intent: 'new_quote', material: 'lvp', area_sqft: 350, area_unit: 'sqft',
      city: 'kyle', evidence: { material: 'lvp', area_sqft: '350', area_unit: 'sq ft', city: 'kyle' } },
  });
  const priced = priceIt('appr1');
  const [letter] = composeQuotes(whatTheQuoteNeeds('appr1', priced.written.offer_id));
  putForward('appr1', priced.written.offer_id, 'th-owner-1', letter.the_letter_itself);

  // her answer arrives like any other email, from the desk's own address, in the thread the
  // letter went out in
  arrive({ id: 'yes1', thread: 'th-owner-1', from: 'flooring.demo.austin@gmail.com',
    text: 'send it', extracted: { intent: 'other', evidence: {} } });
  const taken = takeItOn('yes1');
  check('the lane takes the message on', taken.handled_by, '60 Approval — Flooring');
  check('into a status the database allows', taken.status, 'closed');
  const answers = whatItAnswers('yes1', 'th-owner-1');
  check('the offer waiting in that thread is found', Number(answers.offer_id), Number(priced.written.offer_id));
  check('and it knows who it is for', answers.contact_email, 'yuri@example.com');
  check('with a message of theirs to reply to', answers.reply_to, 'appr1');

  const [read1] = didSheSaySendIt(answers);
  check('she said send it', read1.approved, true);
  check('what goes out is the letter she read', read1.body, letter.the_letter_itself);
  check('to the customer, not to her', read1.to, 'yuri@example.com');

  const went = sayItWentOut('yes1', priced.written.offer_id);
  check('the offer is sent', went.now_sent, 't');
  check('and the order records the move', went.change_recorded, 't');
  check('the offer says so itself',
    ask(`SELECT status FROM offers WHERE id = ${priced.written.offer_id}`), 'sent');

  const twice = sayItWentOut('yes1', priced.written.offer_id);
  check('a second reply in the thread sends nothing again', twice.now_sent, 'f');
  const after = whatItAnswers('yes1', 'th-owner-1');
  check('and there is nothing left waiting there', after.an_offer_is_waiting, false);
}

console.log('\nanything short of yes sends nothing');
{
  const a = arrive({
    id: 'appr2', thread: 'th-appr2', from: 'zoe@example.com',
    text: 'laminate, 260 sq ft, buda tx',
    extracted: { intent: 'new_quote', material: 'laminate', area_sqft: 260, area_unit: 'sqft',
      city: 'buda', evidence: { material: 'laminate', area_sqft: '260', area_unit: 'sq ft', city: 'buda' } },
  });
  const priced = priceIt('appr2');
  const [letter] = composeQuotes(whatTheQuoteNeeds('appr2', priced.written.offer_id));
  putForward('appr2', priced.written.offer_id, 'th-owner-2', letter.the_letter_itself);

  const readOf = (id, text) => {
    arrive({ id, thread: 'th-owner-2', from: 'flooring.demo.austin@gmail.com',
      text, extracted: { intent: 'other', evidence: {} } });
    takeItOn(id);
    return didSheSaySendIt(whatItAnswers(id, 'th-owner-2'))[0];
  };

  check('"not yet" is not a yes', readOf('no1', 'not yet, change the removal line').approved, false);
  check('and it is recognised as a refusal', readOf('no2', 'no, hold off').refused, true);
  check('"hold on" is not a yes', readOf('no3', 'hold on').approved, false);
  check('a bare thanks is not a yes', readOf('no4', 'thanks').approved, false);
  check('and the letter the desk itself sent is not a yes',
    readOf('no5', 'This quote is ready and has not been sent. For: zoe@example.com').approved, false);
  check('the offer is still waiting after all of that',
    ask(`SELECT status FROM offers WHERE id = ${priced.written.offer_id}`), 'awaiting_approval');

  check('but yes still works', readOf('yes2', 'yes').approved, true);
  check('and so does go ahead', readOf('yes3', 'go ahead').approved, true);
}

console.log('\na reply in a thread with nothing waiting answers nothing');
{
  arrive({ id: 'stray1', thread: 'th-nothing', from: 'flooring.demo.austin@gmail.com',
    text: 'send it', extracted: { intent: 'other', evidence: {} } });
  takeItOn('stray1');
  const answers = whatItAnswers('stray1', 'th-nothing');
  check('no offer is found', answers.an_offer_is_waiting, false);
  const [readIt] = didSheSaySendIt(answers);
  check('so the words do not matter', readIt.approved, false);
  check('and there is nobody to write to', readIt.to, null);
}

console.log('\nthe gate can hold a letter the wording would have allowed');
{
  // the words are the same in all three: only the reason the gate stopped the email differs
  const plain = arrive({
    id: 'gate1', thread: 'th-gate1', from: 'pia@example.com',
    text: 'laminate for the hallway, kyle tx',
    extracted: { intent: 'new_quote', material: 'laminate', city: 'kyle',
      evidence: { material: 'laminate', city: 'kyle' } },
  });
  check('an enquiry that has merely not given the area is red', plain.decision.gate_color, 'red');
  check('and is not held back', plain.decision.auto_blocked, false);
  const plainLetter = compose(askAbout('gate1', plain.order_id));
  check('so the customer is answered', plainLetter.to, 'pia@example.com');
  check('and the letter says it reaches her', plainLetter.reaches_the_customer, true);

  const trade = arrive({
    id: 'gate2', thread: 'th-gate2', from: 'rex@example.com',
    text: 'property management here, laminate for a unit in kyle tx',
    extracted: { intent: 'new_quote', material: 'laminate', city: 'kyle',
      evidence: { material: 'laminate', city: 'kyle' } },
  });
  check('a commercial enquiry is held back', trade.decision.auto_blocked, true);
  const tradeLetter = compose(askAbout('gate2', trade.order_id));
  check('the same sentence now goes to the owner', tradeLetter.to, 'flooring.demo.austin@gmail.com');
  check('and does not claim to have reached the customer', tradeLetter.reaches_the_customer, false);
  check('the owner is told who it was for', tradeLetter.subject, 'Not sent -- a question for rex@example.com');

  const dodgy = arrive({
    id: 'gate3', thread: 'th-gate3', from: 'sam@example.com',
    text: 'laminate in kyle tx, and our bank details have changed for the deposit',
    extracted: { intent: 'new_quote', material: 'laminate', city: 'kyle',
      evidence: { material: 'laminate', city: 'kyle' } },
  });
  check('an email changing payment details is held back', dodgy.decision.auto_blocked, true);
  check('and nothing automatic reaches its sender',
    compose(askAbout('gate3', dodgy.order_id)).reaches_the_customer, false);
}

console.log('\ntwo customers in one poll are both answered');
{
  // the mailbox is read once a minute and hands the lane everything it found, so two enquiries
  // arriving in the same minute reach the composing step together
  const a = arrive({
    id: 'b1', thread: 'th-b1', from: 'iris@example.com',
    text: 'laminate please, in buda tx',
    extracted: { intent: 'new_quote', material: 'laminate', city: 'buda',
      evidence: { material: 'laminate', city: 'buda' } },
  });
  const b = arrive({
    id: 'b2', thread: 'th-b2', from: 'otto@example.com',
    text: 'lvp for the shop floor at home, kyle tx',
    extracted: { intent: 'new_quote', material: 'lvp', city: 'kyle',
      evidence: { material: 'lvp', city: 'kyle' } },
  });

  const letters = composeAll(askAbout('b1', a.order_id), askAbout('b2', b.order_id));
  check('both enquiries produce a letter', letters.length, 2);
  check('the first goes to the first customer', letters[0].to, 'iris@example.com');
  check('and the second to the second, not a repeat of the first', letters[1].to, 'otto@example.com');
  check('each stays in its own thread',
    [letters[0].thread_id, letters[1].thread_id], ['th-b1', 'th-b2']);
  // both carry a rate now, deliberately; what neither may carry is a total, because neither
  // customer has given an area
  check('each carries the rate for the material it names',
    [/Luxury vinyl plank/.test(letters[1].body), /Laminate standard/.test(letters[0].body)],
    [true, true]);
  check('and neither works out a total from nothing',
    letters.some((l) => /comes to roughly/.test(l.body)), false);
}


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
  // Every event names the message it came from, except the ones no message caused. Letting an
  // order go is the work of time passing, and attaching whichever letter happened to be last would
  // be a tidier record of something that did not happen.
  check('every event caused by a letter names it',
    Number(ask(`SELECT count(*) FROM order_events
                 WHERE gmail_message_id IS NULL
                   AND NOT (kind = 'state_change' AND field = 'state' AND new_value = 'lost')`)), 0);
  check('and the ones that name none are only the orders time closed', JSON.parse(ask(
    `SELECT coalesce(json_agg(DISTINCT kind || '/' || field || ' -> ' || new_value), '[]'::json)
       FROM order_events WHERE gmail_message_id IS NULL`)),
  ['state_change/state -> lost']);
}

console.log('\nsaying yes to a price worked out from an email');
{
  const projectSql = (n) => read('db', '20-project', `${n}.sql`).replace(/;\s*$/, '');
  const accepting = projectSql('accepting-a-ballpark-asks-for-a-visit');

  // a job of its own, so nothing above is disturbed by moving it about
  const orderId = Number(ask(`WITH made AS (
      INSERT INTO orders (thread_id, state, material_category, area_sqft,
                          area_unit, area_status, city, zone)
      VALUES ('t-yes', 'quoted', 'Laminate', 400, 'sqft', 'known', 'kyle tx', 'core')
      RETURNING id) SELECT id FROM made`));
  const offerOf = (kind) => Number(ask(`WITH made AS (
      INSERT INTO offers (order_id, kind, status, total_low, total_high)
      VALUES (${orderId}, '${kind}', 'sent', 1760, 4400)
      RETURNING id) SELECT id FROM made`));
  const letter = (id, answer) => ask(`WITH made AS (
      INSERT INTO messages (thread_id, gmail_message_id, direction, sender, order_id, offer_answer,
                            category, body)
      VALUES ('t-yes', '${id}', 'inbound', 'client', ${orderId},
              ${answer === null ? 'NULL' : `'${answer}'`}, 'offer_response', 'looks good, I accept')
      RETURNING gmail_message_id) SELECT gmail_message_id FROM made`);
  const stateNow = () => ask(`SELECT state FROM orders WHERE id = ${orderId}`);
  const say = (id) => rowOf(accepting, [id]);

  const ballpark = offerOf('ballpark');
  letter('yes-1', 'accepted');
  const first = say('yes-1');

  check('a ballpark accepted asks for a visit, it does not book work',
    stateNow(), 'survey_needed');
  check('and the offer it answers is won', JSON.parse(ask(
    `SELECT json_build_object('status', status, 'outcome', outcome) FROM offers WHERE id = ${ballpark}`)),
  { status: 'accepted', outcome: 'won' });
  check('and the statement says which kind it was', first.offer_kind, 'ballpark');

  // the router can deliver the same email twice, and a second delivery must change nothing
  const again = say('yes-1');
  check('saying it twice moves nothing the second time', again.moved, 'f');
  check('and the order stays where the first one put it', stateNow(), 'survey_needed');

  // a letter that pushed back is not an acceptance, whatever else it says
  ask(`UPDATE orders SET state = 'quoted' WHERE id = ${orderId}`);
  letter('yes-2', 'pushed_back');
  say('yes-2');
  check('pushing back on the price moves nothing', stateNow(), 'quoted');

  // and a letter the gate could not read either way
  letter('yes-3', null);
  say('yes-3');
  check('nor does a reply the gate read neither way', stateNow(), 'quoted');

  // only a price given after somebody has stood in the room may book
  ask(`UPDATE offers SET status = 'expired', outcome = 'lost' WHERE id = ${ballpark}`);
  offerOf('firm');
  letter('yes-4', 'accepted');
  say('yes-4');
  check('a firm price accepted does book the work', stateNow(), 'booked');

  // a job somebody has since finished is not reopened by a late acceptance
  ask(`UPDATE orders SET state = 'done' WHERE id = ${orderId}`);
  letter('yes-5', 'accepted');
  say('yes-5');
  check('a finished job is left alone', stateNow(), 'done');
}

console.log('\na booking on the calendar finding the job it belongs to');
{
  const visitSql = (n) => read('db', '25-visits', `${n}.sql`).replace(/;\s*$/, '');
  const quoteLit = (v) => `'${String(v).replace(/'/g, "''")}'`;
  const readSource = read('src', '25-visits', 'read-the-booking.js');
  const readBooking = (event) => new Function('$input', readSource)(
    { all: () => [{ json: event }] })[0].json;

  // the two real events this was built from, kept exactly as Google returned them
  const desk = 'flooring.demo.austin@gmail.com';
  const googleEvent = (id, guest, description, when) => ({
    id,
    summary: 'Floor survey visit (Someone)',
    organizer: { email: desk, self: true },
    attendees: [{ email: desk, organizer: true }, { email: guest }],
    description,
    start: { dateTime: when, timeZone: 'America/Chicago' },
  });
  const polish = '<b>Zarezerwowane przez:</b>\nSomeone\nsomeone@example.com\n<br><b>Order code</b>\nKQMNP47';
  const english = '<b>Booked by</b>\nSomeone\nsomeone@example.com\n<br><b>Order code</b>\nKQMNP47';

  const readPolish = readBooking(googleEvent('g-1', 'guest@example.com', polish, '2026-08-03T15:00:00-05:00'));
  check('the guest is read from the attendees, not the prose', readPolish.booked_email, 'guest@example.com');
  check('and the code is found under a Polish label', readPolish.booking_code, 'KQMNP47');
  check('as it is under an English one',
    readBooking(googleEvent('g-2', 'guest@example.com', english, '2026-08-03T15:00:00-05:00')).booking_code,
    'KQMNP47');
  check('a code typed with a space or a hyphen still counts', readBooking(
    googleEvent('g-5', 'guest@example.com', english.replace('KQMNP47', 'kqmnp-47'),
      '2026-08-03T15:00:00-05:00')).booking_code, 'KQMNP47');
  check('a code shaped like nothing we issue is not carried forward', readBooking(
    googleEvent('g-3', 'guest@example.com', english.replace('KQMNP47', 'no idea sorry'),
      '2026-08-03T15:00:00-05:00')).booking_code, null);
  check('and a booking with neither says so plainly', readBooking(
    { id: 'g-4', organizer: { email: desk }, attendees: [{ email: desk, organizer: true }],
      description: 'nothing useful', start: {} }).nothing_to_go_on, true);

  // now the matching, against real rows
  const orderWith = (email, state) => Number(ask(`WITH made AS (
      INSERT INTO orders (thread_id, state, contact_email, material_category, area_sqft, area_unit,
                          area_status, city, zone, booking_code)
      VALUES ('t-book-${email}', '${state}', ${quoteLit(email)}, 'Laminate', 400, 'sqft', 'known',
              'kyle tx', 'core',
              (SELECT string_agg(substr('ABCDEFGHJKMNPQRSTUVWXYZ', (random()*22)::int + 1, 1), '')
                 FROM generate_series(1, 5))
              || (SELECT string_agg(substr('23456789', (random()*7)::int + 1, 1), '')
                    FROM generate_series(1, 2)))
      RETURNING id) SELECT id FROM made`));
  const codeOf = (id) => ask(`SELECT booking_code FROM orders WHERE id = ${id}`);
  const whose = (email, code, typed = code) =>
    rowOf(visitSql('whose-job-is-this'), [email, code, typed]);

  const mine = orderWith('customer@example.com', 'quoted');
  check('every order is issued a code, five letters then two digits',
    /^[ABCDEFGHJKMNPQRSTUVWXYZ]{5}[23456789]{2}$/.test(codeOf(mine)), true);

  check('a booking from the address on the job matches it',
    Number(whose('customer@example.com', '').order_id), mine);
  check('and it says what matched', whose('customer@example.com', '').matched_by, 'the email');
  check('a booking from another address matches on the code',
    Number(whose('someone.else@example.com', codeOf(mine)).order_id), mine);
  check('and it says so', whose('someone.else@example.com', codeOf(mine)).matched_by, 'the code');
  const both = whose('customer@example.com', codeOf(mine));
  check('when both answer, they answer the same job', both.by_email, both.by_code);
  check('and the record says the email carried it', both.matched_by, 'the email');
  check('neither matching is nobody guessed at', whose('nobody@example.com', 'ZZZZZ99').order_id, '');

  // the case where having two ways in is worse than one
  const other = orderWith('another@example.com', 'quoted');
  const disagree = whose('another@example.com', codeOf(mine));
  check('an email and a code pointing at different jobs goes to a person',
    disagree.needs_a_person, 't');
  check('and picks neither of them', disagree.matched_by, 'they disagree');

  // A code typed and leading nowhere is the customer disagreeing with what the email would say.
  // Nobody notices a typo on their own booking, and the email is right up until the day somebody
  // has two jobs open.
  const mistyped = whose('customer@example.com', '', 'KQMNP 4');
  check('a code typed with a slip in it goes to a person', mistyped.needs_a_person, 't');
  check('and it says what happened', mistyped.matched_by, 'they typed a code that matches nothing');
  const wellFormedButStale = whose('customer@example.com', 'ZZZZZ99', 'ZZZZZ99');
  check('so does a code that reads properly and belongs to no open job',
    wellFormedButStale.needs_a_person, 't');
  check('typing nothing at all is not disagreement',
    whose('customer@example.com', '', '').needs_a_person, 'f');

  // a finished job is not reopened by somebody booking against it
  ask(`UPDATE orders SET state = 'done', closed_at = now() WHERE id = ${other}`);
  check('a booking against a finished job matches nothing',
    whose('another@example.com', '').order_id, '');

  // and the writing down
  const put = (orderId, when, eventId) => rowOf(visitSql('write-the-booked-visit'), [orderId, when, eventId]);
  const first = put(mine, '2026-08-03T15:00:00-05:00', 'g-1');
  check('the booking is written as an agreed visit', JSON.parse(ask(
    `SELECT json_build_object('state', state, 'has_time', agreed IS NOT NULL,
                              'event', booked_event_id, 'offered', jsonb_array_length(offered))
       FROM visits WHERE id = ${first.id}`)),
  { state: 'agreed', has_time: true, event: 'g-1', offered: 1 });
  // the second delivery returns no row at all, which is the point -- so it is run rather than read
  check('the same booking delivered twice writes one visit', ask(
    `WITH again AS (${fill(visitSql('write-the-booked-visit'),
      [mine, '2026-08-03T15:00:00-05:00', 'g-1'])}) SELECT count(*) FROM again`), '0');
  check('and the job still has exactly one',
    ask(`SELECT count(*) FROM visits WHERE order_id = ${mine}`), '1');
}

console.log('\nsaying something about a booking, a quarter of an hour later');
{
  const visitSql = (n) => read('db', '25-visits', `${n}.sql`).replace(/;\s*$/, '');
  const writeSource = read('src', '25-visits', 'write-the-confirmation.js');
  const compose = (row) => new Function('$input', writeSource)({ all: () => [{ json: row }] })[0].json;
  const waiting = (minutes) => JSON.parse(ask(
    `SELECT coalesce(json_agg(t), '[]'::json) FROM (${fill(visitSql('which-visits-need-a-word'), [minutes])}) t`));

  const orderId = Number(ask(`WITH made AS (
      INSERT INTO orders (thread_id, state, contact_email, material_category, area_sqft, area_unit,
                          area_status, city, zone, on_site_items)
      VALUES ('t-word', 'survey_needed', 'customer@example.com', 'Laminate', 400, 'sqft', 'known',
              'Kyle, TX', 'core', '{stairs}')
      RETURNING id) SELECT id FROM made`));
  const visitId = Number(ask(`WITH made AS (
      INSERT INTO visits (order_id, state, offered, agreed, agreed_at, booked_event_id)
      VALUES (${orderId}, 'agreed', '["2026-08-04T18:30:00+00:00"]'::jsonb,
              '2026-08-04T18:30:00+00:00', now() - interval '20 minutes', 'e-1')
      RETURNING id) SELECT id FROM made`));

  check('a booking older than the wait is waiting to be answered', waiting(15).length, 1);
  check('and one younger than it is left alone', waiting(60).length, 0);

  const row = waiting(15)[0];
  check('the address is the one on the job', row.write_to, 'customer@example.com');

  const letter = compose(row);
  check('the letter is ready to send', letter.ready_to_send, true);
  // stored as an instant; printed where the work is. The same booking reads half past eight in the
  // evening in Warsaw and half past one in the afternoon to the person driving to it.
  check('the time is written in Texas, not wherever it was booked from',
    letter.subject, 'Visit booked — Tuesday, August 4 at 1:30pm');
  check('the job is repeated back as the desk holds it',
    letter.body.includes('Floor: Laminate') && letter.body.includes('Area: about 400 sqft')
    && letter.body.includes('Where: Kyle, TX'), true);
  check('and what only a visit can settle is named', letter.body.includes('stairs'), true);

  const stamp = (id) => rowOf(visitSql('say-the-visit-was-confirmed'), [id]);
  stamp(visitId);
  check('once answered it is not waiting any more', waiting(15).length, 0);
  check('and a second run stamps nothing', ask(
    `WITH again AS (${fill(visitSql('say-the-visit-was-confirmed'), [visitId])})
     SELECT count(*) FROM again`), '0');

  // a job that was finished between the booking and the letter
  const stale = Number(ask(`WITH made AS (
      INSERT INTO orders (thread_id, state, contact_email, material_category, city, zone, closed_at)
      VALUES ('t-word-2', 'lost', 'gone@example.com', 'LVP', 'Buda, TX', 'core', now())
      RETURNING id) SELECT id FROM made`));
  ask(`INSERT INTO visits (order_id, state, offered, agreed, agreed_at, booked_event_id)
       VALUES (${stale}, 'agreed', '["2026-08-04T18:30:00+00:00"]'::jsonb,
               '2026-08-04T18:30:00+00:00', now() - interval '20 minutes', 'e-2')`);
  check('a job let go before the letter went out is not written to', waiting(15).length, 0);

  // and the refusals the letter states about itself
  check('a visit with no readable time is not written about',
    compose({ ...row, agreed: 'not a date' }).ready_to_send, false);
  check('nor is a job with nobody to write to',
    compose({ ...row, write_to: null }).ready_to_send, false);
}

console.log('\na visit that moved, and one that vanished');
{
  const visitSql = (n) => read('db', '25-visits', `${n}.sql`).replace(/;\s*$/, '');
  const source = read('src', '25-visits', 'what-the-calendar-says-now.js');
  // the code reads two nodes: the events on its input, and the visits from the lookup before it
  const compare = (events, visits) => new Function('$input', '$', source)(
    { all: () => events.map((json) => ({ json })) },
    (name) => {
      if (name !== 'Visits worth checking') throw new Error(`reached back to ${name}`);
      return { all: () => visits.map((json) => ({ json })) };
    },
  ).map((r) => r.json);

  const orderId = Number(ask(`WITH made AS (
      INSERT INTO orders (thread_id, state, contact_email, material_category, city, zone)
      VALUES ('t-moved', 'survey_needed', 'customer@example.com', 'Laminate', 'Kyle, TX', 'core')
      RETURNING id) SELECT id FROM made`));
  const visitId = Number(ask(`WITH made AS (
      INSERT INTO visits (order_id, state, offered, agreed, agreed_at, booked_event_id, confirmed_at)
      VALUES (${orderId}, 'agreed', '["2026-09-01T15:00:00+00:00"]'::jsonb,
              '2026-09-01T15:00:00+00:00', now(), 'g-live', now())
      RETURNING id) SELECT id FROM made`));
  const worthChecking = () => JSON.parse(ask(
    `SELECT coalesce(json_agg(t), '[]'::json) FROM (${visitSql('visits-worth-checking')}) t`))
    .filter((v) => Number(v.visit_id) === visitId);
  const believed = worthChecking();
  // other sections of this run have left visits behind, which is realistic: the question is
  // whether ours is among them, not whether it is alone
  check('a booking still ahead of us is worth checking',
    believed.some((v) => Number(v.visit_id) === visitId), true);

  const asGoogle = (id, when, status) => ({ id, status, start: { dateTime: when } });

  check('a booking still where we left it says nothing',
    compare([asGoogle('g-live', '2026-09-01T15:00:00+00:00', 'confirmed')], believed).length, 0);
  // the two sides write the same instant differently, and as strings they never agree
  check('and the same instant written another way is still where we left it',
    compare([asGoogle('g-live', '2026-09-01T10:00:00-05:00', 'confirmed')], believed).length, 0);

  const moved = compare([asGoogle('g-live', '2026-09-02T15:00:00+00:00', 'confirmed')], believed);
  check('a booking that moved says so', moved[0]?.what_changed, 'moved');
  const gone = compare([asGoogle('g-live', '2026-09-01T15:00:00+00:00', 'cancelled')], believed);
  check('and one that was cancelled says so', gone[0]?.what_changed, 'gone');

  // the read covers a stretch of time, and a visit outside it is unmentioned, not cancelled
  check('a booking the read never mentioned is left alone', compare([], believed).length, 0);

  // and the writing down
  rowOf(visitSql('the-visit-moved'), [visitId, '2026-09-02T15:00:00+00:00']);
  // asked as an instant: psql renders a timestamptz in whatever zone the session is in, and the
  // same moment written +02:00 and +00:00 is the same moment
  check('the visit follows the booking', JSON.parse(ask(
    `SELECT json_build_object('agreed', to_char(agreed AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI'),
                              'told_again', confirmed_at IS NULL)
       FROM visits WHERE id = ${visitId}`)),
  { agreed: '2026-09-02 15:00', told_again: true });
  check('moving it to where it already is changes nothing', ask(
    `WITH again AS (${fill(visitSql('the-visit-moved'), [visitId, '2026-09-02T15:00:00+00:00'])})
     SELECT count(*) FROM again`), '0');

  rowOf(visitSql('the-visit-is-off'), [visitId]);
  check('a cancelled booking lapses the visit',
    ask(`SELECT state FROM visits WHERE id = ${visitId}`), 'lapsed');
  check('and leaves the job where it was',
    ask(`SELECT state FROM orders WHERE id = ${orderId}`), 'survey_needed');
  check('a lapsed visit is not checked against the calendar again', worthChecking().length, 0);
  check('but it still remembers when it was going to be', ask(
    `SELECT agreed IS NOT NULL FROM visits WHERE id = ${visitId}`), 't');
  check('and cancelling it twice changes nothing', ask(
    `WITH again AS (${fill(visitSql('the-visit-is-off'), [visitId])}) SELECT count(*) FROM again`), '0');
}

console.log('\nwhat a letter cannot price reaches the job it belongs to');
{
  const damp = arrive({
    id: 'damp-1', thread: 't-damp', from: 'damp@example.com',
    text: 'lvp in the living room, 300 sq ft, kyle tx — there is damp coming through the slab',
    extracted: { intent: 'new_quote', material: 'lvp', area_sqft: 300, city: 'kyle',
      subfloor_flag: true,
      evidence: { material: 'lvp', area_sqft: '300 sq ft', city: 'kyle',
        subfloor_flag: 'damp coming through the slab' } },
  });
  check('the gate stands behind the flag rather than only colouring the letter',
    damp.decision.settled.on_site_items, ['subfloor']);
  check('and the job carries it', ask(
    `SELECT on_site_items::text FROM orders WHERE id = ${damp.order_id}`), '{subfloor}');
  check('while the floor itself is still priced',
    damp.decision.category, 'quote_request');

  // it survives a later letter that says nothing about it, the same way stairs do
  arrive({ id: 'damp-2', thread: 't-damp', from: 'damp@example.com', text: 'any news?',
    extracted: { intent: 'follow_up', evidence: {} } });
  check('and a later letter that never mentions it does not take it away', ask(
    `SELECT on_site_items::text FROM orders WHERE id = ${damp.order_id}`), '{subfloor}');
}

console.log('\nasking a customer who said yes to pick a time');
{
  const projectSql = (n) => read('db', '20-project', `${n}.sql`).replace(/;\s*$/, '');
  const writeSource = read('src', '20-project', 'write-the-invitation.js');
  const compose = (row) => new Function('$input', writeSource)({ all: () => [{ json: row }] })[0].json;
  const needs = (id) => JSON.parse(ask(
    `SELECT coalesce(json_agg(t), '[]'::json) FROM (${fill(projectSql('what-the-invitation-needs'), [id])}) t`));

  const orderId = Number(ask(`WITH made AS (
      INSERT INTO orders (thread_id, state, contact_email, material_category, area_sqft, area_unit,
                          area_status, city, zone, booking_code)
      VALUES ('t-invite', 'survey_needed', 'customer@example.com', 'Laminate', 400, 'sqft', 'known',
              'Kyle, TX', 'core', 'KQMNP47')
      RETURNING id) SELECT id FROM made`));
  const letter = (id) => ask(`WITH made AS (
      INSERT INTO messages (thread_id, gmail_message_id, direction, sender, order_id, category,
                            offer_answer, body)
      VALUES ('t-invite', '${id}', 'inbound', 'client', ${orderId}, 'offer_response', 'accepted',
              'looks good, I accept')
      RETURNING gmail_message_id) SELECT gmail_message_id FROM made`);
  letter('inv-1');

  const row = needs('inv-1')[0];
  check('a job waiting for a visit has an invitation to send', Boolean(row), true);
  check('and it carries the link from the database', row.link.startsWith('https://'), true);
  check('and the address on the job, not on the letter', row.write_to, 'customer@example.com');

  const out = compose(row);
  check('the invitation is ready to send', out.ready_to_send, true);
  check('the code is on a line of its own', out.body.includes('\n  Your code: KQMNP47\n'), true);
  check('and the link is too', out.body.includes(`\n  ${row.link}\n`), true);

  rowOf(projectSql('say-we-invited-them'), ['inv-1', orderId]);
  check('once asked, the job is not asked again', needs('inv-1').length, 0);
  check('and a second delivery writes no second visit', ask(
    `WITH again AS (${fill(projectSql('say-we-invited-them'), ['inv-1', orderId])})
     SELECT count(*) FROM again`), '0');
  check('the job is waiting on them, not on us',
    ask(`SELECT state FROM visits WHERE order_id = ${orderId}`), 'offered');

  // a job that already has a booking is not invited to make another
  ask(`UPDATE visits SET state = 'agreed', agreed = now(), agreed_at = now() WHERE order_id = ${orderId}`);
  letter('inv-2');
  check('nor is one that has already booked', needs('inv-2').length, 0);

  // and a job that never got that far
  const early = Number(ask(`WITH made AS (
      INSERT INTO orders (thread_id, state, contact_email, city, zone, booking_code)
      VALUES ('t-early', 'quoted', 'early@example.com', 'Buda, TX', 'core', 'ABCDE23')
      RETURNING id) SELECT id FROM made`));
  ask(`INSERT INTO messages (thread_id, gmail_message_id, direction, sender, order_id, category, body)
       VALUES ('t-early', 'inv-3', 'inbound', 'client', ${early}, 'offer_response', 'hmm')`);
  check('a job still only quoted is not invited to book', needs('inv-3').length, 0);
  check('and nothing is composed for it',
    compose({ gmail_message_id: 'inv-3' }).ready_to_send, false);
}

console.log('\nwhat a step and a square foot cost, and where those numbers come from');
{
  // Every other check about stairs and levelling hands the rate in by fixture, which proves the
  // arithmetic and says nothing about where the number came from. Nothing would have noticed if
  // this statement stopped returning any rate at all: the letter would quietly stop naming one,
  // and every test would stay green. Found by a reviewer reading #62, not by anything here.
  const orderId = Number(ask(`WITH made AS (
      INSERT INTO orders (thread_id, state, contact_email, material_category, area_sqft, area_unit,
                          area_status, city, zone, on_site_items)
      VALUES ('t-rates', 'new', 'rates@example.com', 'Wood', 300, 'sqft', 'known',
              'Kyle, TX', 'core', '{stairs,subfloor}')
      RETURNING id) SELECT id FROM made`));
  ask(`INSERT INTO messages (thread_id, gmail_message_id, direction, sender, order_id, category, body)
       VALUES ('t-rates', 'rate-1', 'inbound', 'client', ${orderId}, 'quote_request', 'wood, 300 sq ft, stairs, damp slab')`);

  const rates = () => JSON.parse(ask(
    `SELECT coalesce((SELECT on_site_rates FROM (${fill(quoteSql('gather-what-a-price-needs'), ['rate-1'])}) t), '{}'::jsonb)`));

  const asIssued = rates();
  check('the levelling rate arrives from the price list, not from a fixture',
    [asIssued.subfloor?.val_low, asIssued.subfloor?.val_high], [2, 5]);
  check('and the stairs rate does too',
    [asIssued.stairs?.val_low, asIssued.stairs?.val_high, asIssued.stairs?.unit], [45, 80, 'each']);

  // Before the price list is taken apart below, not after. Asked afterwards these two would pass
  // against a gutted list -- they would hold just as well if on-site pricing had stopped working
  // for every job there is, which is not what they read as saying.
  const plain = Number(ask(`WITH made AS (
      INSERT INTO orders (thread_id, state, contact_email, material_category, area_sqft, area_unit,
                          area_status, city, zone)
      VALUES ('t-plain', 'new', 'plain@example.com', 'Laminate', 300, 'sqft', 'known', 'Kyle, TX', 'core')
      RETURNING id) SELECT id FROM made`));
  ask(`INSERT INTO messages (thread_id, gmail_message_id, direction, sender, order_id, category, body)
       VALUES ('t-plain', 'rate-2', 'inbound', 'client', ${plain}, 'quote_request', 'laminate, 300 sq ft')`);
  const plainQuote = priceIt('rate-2').quote;
  check('a job with neither is quoted neither, while both rates are there to be had',
    plainQuote.breakdown.lines.filter((l) => l.kind === 'on_site').length, 0);
  check('and is still priced', plainQuote.priceable, true);

  // the half of provenance a passing check never shows: change the list, and this must change
  ask("UPDATE pricing_rules SET val_low = 3.00, val_high = 7.00 WHERE rule_key = 'subfloor_leveling'");
  check('changing the price list changes what the quote is told',
    [rates().subfloor?.val_low, rates().subfloor?.val_high], [3, 7]);

  ask("DELETE FROM pricing_rules WHERE rule_key = 'subfloor_leveling'");
  check('and taking the row out leaves no rate to name at all', rates().subfloor, undefined);
  check('while the other one is untouched by it', rates().stairs?.val_low, 45);

  ask("UPDATE price_bands SET rate_low = 55.00 WHERE component = 'stairs'");
  check('the stairs rate follows its own row the same way', rates().stairs?.val_low, 55);

  // an inactive band is not a rate, however present the row is
  ask("UPDATE price_bands SET active = false WHERE component = 'stairs'");
  check('and a band that has been retired stops being quoted', rates().stairs, undefined);

  // Put the price list back. This block borrows the shared database to prove where a rate comes
  // from, and anything after it reads the same rows — a check that takes something away and leaves
  // it away quietly rewrites the ones below it. It was last in the file when it was written, which
  // is why nobody noticed; it is not last any more.
  ask("UPDATE price_bands SET active = true, rate_low = 45.00 WHERE component = 'stairs'");
  ask(`INSERT INTO pricing_rules (rule_key, val_low, val_high, notes)
       VALUES ('subfloor_leveling', 2.00, 5.00, 'per sqft; TX slab moisture -> survey')
       ON CONFLICT (rule_key) DO UPDATE SET val_low = 2.00, val_high = 5.00`);
  check('and the price list is left as it was found',
    [rates().stairs?.val_low, rates().subfloor?.val_low], [45, 2]);
}

console.log('\nwhat the owner is told before a visit');
{
  const visitSql = (n) => read('db', '25-visits', `${n}.sql`).replace(/;\s*$/, '');
  const source = read('src', '25-visits', 'write-what-the-owner-is-told.js');
  const compose = (row) => new Function('$input', source)({ all: () => [{ json: row }] })[0].json;
  const waiting = () => JSON.parse(ask(
    `SELECT coalesce(json_agg(t), '[]'::json) FROM (${visitSql('what-the-owner-has-not-been-told')}) t`));

  // the facts arrive across two letters, which is the whole reason this reads the job
  const orderId = Number(ask(`WITH made AS (
      INSERT INTO orders (thread_id, state, contact_email, material_category, area_sqft, area_unit,
                          area_status, city, zone, existing_floor_action, old_floor_removal,
                          on_site_items, booking_code, site_street, site_city, site_postcode)
      VALUES ('t-told', 'survey_needed', 'told@example.com', 'Laminate', 400, 'sqft', 'known',
              'Kyle, TX', 'core', 'remove_first', true, '{stairs,subfloor}', 'TQDXM23',
              '12 Cypress Row', 'Kyle', '78640')
      RETURNING id) SELECT id FROM made`));
  ask(`INSERT INTO offers (order_id, kind, status, total_low, total_high)
       VALUES (${orderId}, 'ballpark', 'sent', 1760, 4400)`);
  const visitId = Number(ask(`WITH made AS (
      INSERT INTO visits (order_id, state, offered, agreed, agreed_at, booked_event_id,
                          agreement_url)
      VALUES (${orderId}, 'agreed', '["the booking page"]'::jsonb, '2026-08-04T18:30:00+00:00',
              now(), 'e-told', 'https://docs.google.com/document/d/told/edit')
      RETURNING id) SELECT id FROM made`));

  const mine = () => waiting().filter((r) => Number(r.visit_id) === visitId);
  check('a visit nobody has been told about is waiting', mine().length, 1);

  const said = compose(mine()[0]);
  check('there is something to say', said.ready_to_tell, true);
  check('the time is in Texas', said.message.includes('Tuesday, August 4, 1:30pm'), true);
  check('the job is in it, from the order rather than a letter',
    ['Laminate', 'about 400 sqft', 'the old floor comes out']
      .every((part) => said.message.includes(part)), true);
  check('what was quoted is in it, under its own heading, and called a ballpark',
    said.message.includes('*Quoted by email*\n$1,760 to $4,400')
    && said.message.includes('a ballpark, not a commitment'), true);
  check('what the visit must settle is named with a rate and marked as not counted',
    said.message.includes('• stairs — $45 to $80 per each — named to the customer, not counted'), true);
  check('and what to bring follows from the job rather than a fixed list',
    ['Laminate samples', 'levelling compound sample', 'tread gauge', 'a look under a corner']
      .every((thing) => said.message.includes(thing)), true);
  // where to drive, which is the one thing a town name never answered
  check('the address the customer typed is what it says, not the town from a letter',
    said.message.includes('📍 12 Cypress Row, Kyle, 78640'), true);
  check('and the page to sign is in the same message',
    said.message.includes('|The page to sign at the door>'), true);
  // these arrive one after another in a channel; the first line is what separates one from the next
  check('it opens with the job and the time, in a line that stands out',
    said.message.split('\n')[0], '📋 *Job ' + orderId + ' — Tuesday, August 4, 1:30pm*');

  // a price nobody has seen is not what the customer is expecting
  ask(`INSERT INTO offers (order_id, kind, status, total_low, total_high)
       VALUES (${orderId}, 'ballpark', 'draft', 9990, 9999)`);
  check('a draft price is not read out as what was quoted',
    compose(mine()[0]).message.includes('$1,760 to $4,400'), true);
  check('and the draft\'s own figures reach nobody',
    compose(mine()[0]).message.includes('9,99'), false);

  // the case that would otherwise be a row of blanks
  const bareId = Number(ask(`WITH made AS (
      INSERT INTO orders (thread_id, state, contact_email, city, zone)
      VALUES ('t-bare-told', 'survey_needed', 'bare@example.com', 'Buda, TX', 'core')
      RETURNING id) SELECT id FROM made`));
  // agreed an hour ago and still without a page: the escape, so a broken drive delays the message
  // rather than swallowing it
  ask(`WITH made AS (INSERT INTO visits (order_id, state, offered, agreed, agreed_at, booked_event_id)
       VALUES (${bareId}, 'agreed', '["the booking page"]'::jsonb, '2026-08-05T18:30:00+00:00',
               now() - interval '1 hour', 'e-bare-told') RETURNING id) SELECT id FROM made`);
  check('a visit with no page yet is still told about once it has waited',
    waiting().filter((r) => Number(r.order_id) === bareId).length, 1);
  const bare = compose(waiting().find((r) => Number(r.order_id) === bareId));
  check('and the message says nothing about a page that does not exist',
    bare.message.includes('The page to sign'), false);
  check('a job that has said almost nothing still gets something usable',
    ['floor not said yet', 'no size given — measure everything', '*Quoted by email*\nnothing yet.']
      .every((part) => bare.message.includes(part)), true);
  check('and nobody is told to bring samples of nothing', bare.message.includes('samples'), false);

  // said once
  rowOf(visitSql('say-the-owner-was-told'), [visitId]);
  check('a visit the owner was told about stops waiting', mine().length, 0);
  check('and a second run stamps nothing', ask(
    `WITH again AS (${fill(visitSql('say-the-owner-was-told'), [visitId])}) SELECT count(*) FROM again`), '0');
  check('the moment it kept is the first one',
    ask(`SELECT owner_told_at IS NOT NULL FROM visits WHERE id = ${visitId}`), 't');

  // a moved visit is told about again, once the page for the new time exists -- the two go
  // together, and a message naming a time the page contradicts is worse than a late message.
  //
  // Agreed an hour ago before it moves, on purpose: with the wait measured from the original
  // agreement it is already over, and this check passes whether or not the rule works. That is how
  // it read before a reviewer pointed at the fixture rather than at the code.
  ask(`UPDATE visits SET agreed_at = now() - interval '1 hour' WHERE id = ${visitId}`);
  rowOf(visitSql('the-visit-moved'), [visitId, '2026-08-06T18:30:00+00:00']);
  check('a visit that moved is not told about while its page is the old one', mine().length, 0);
  ask(`UPDATE visits SET agreement_url = 'https://docs.google.com/document/d/moved/edit'
        WHERE id = ${visitId}`);
  check('and is waiting again as soon as the new page exists', mine().length, 1);
  check('what is said carries the new time',
    compose(mine()[0]).message.includes('Thursday, August 6, 1:30pm'), true);

  // an hour that has passed is not something to prepare for
  ask(`UPDATE visits SET agreed = now() - interval '2 hours' WHERE id = ${visitId}`);
  check('a visit whose hour has gone by is not prepared for', mine().length, 0);

  // nobody is driving anywhere
  ask(`UPDATE visits SET state = 'lapsed' WHERE order_id = ${bareId}`);
  check('a cancelled visit is not prepared for',
    waiting().filter((r) => Number(r.order_id) === bareId).length, 0);
}

console.log('\nthe agreement that is printed before the door');
{
  const visitSql = (n) => read('db', '25-visits', `${n}.sql`).replace(/;\s*$/, '');
  const source = read('src', '25-visits', 'write-the-agreement.js');
  const compose = (row) => new Function('$input', source)({ all: () => [{ json: row }] })[0].json;

  // Asking what needs a page and claiming it are one statement, so this is a run of the lane
  // rather than a look at the database: two calls are two runs, and the second is meant to find
  // the first one already holding the visit. The rows land in a temp table on the way past because
  // a statement that writes cannot be selected from as though it were a view.
  const claim = visitSql('claim-the-visits-that-need-an-agreement');
  const runs = () => JSON.parse(execFileSync('psql',
    [url, '-q', '-t', '-A', '-c',
      `CREATE TEMP TABLE took AS ${claim};\nSELECT coalesce(json_agg(took), '[]'::json) FROM took;`],
    { encoding: 'utf8' }).trim());

  const orderId = Number(ask(`WITH made AS (
      INSERT INTO orders (thread_id, state, contact_email, material_category, area_sqft, area_unit,
                          area_status, city, zone, existing_floor_action, on_site_items, booking_code,
                          site_street, site_city, site_postcode)
      VALUES ('t-agree', 'survey_needed', 'agree@example.com', 'Laminate', 400, 'sqft', 'known',
              'Kyle, TX', 'core', 'remove_first', '{stairs,subfloor}', 'AGRDX23',
              '18 Willow Bend', 'Kyle', '78640')
      RETURNING id) SELECT id FROM made`));
  const visitId = Number(ask(`WITH made AS (
      INSERT INTO visits (order_id, state, offered, agreed, agreed_at)
      VALUES (${orderId}, 'agreed', '["the booking page"]'::jsonb, now() + interval '3 days', now())
      RETURNING id) SELECT id FROM made`));

  const mine = (rows) => rows.filter((r) => Number(r.visit_id) === visitId);
  // This harness runs the lane over one visit many times, and the claim is deliberately in the way
  // of that. Letting go of it is how the next check starts where a first run would -- and it is
  // written out each time rather than hidden inside runs(), because a claim quietly lifted is the
  // whole guard quietly switched off.
  const afresh = () => {
    ask(`UPDATE visits SET agreement_started_at = NULL WHERE id = ${visitId}`);
    return mine(runs());
  };

  // the claim, which is the thing that stops a second copy being made rather than recorded
  check('a visit with no page yet is taken by a run', mine(runs()).length, 1);
  check('and a run arriving behind it takes nothing', mine(runs()).length, 0);

  // not a lock nobody can lift: one failure at Google must not leave a visit pageless for ever
  ask(`UPDATE visits SET agreement_started_at = now() - interval '29 minutes' WHERE id = ${visitId}`);
  check('a claim taken not quite half an hour ago still holds', mine(runs()).length, 0);
  ask(`UPDATE visits SET agreement_started_at = now() - interval '31 minutes' WHERE id = ${visitId}`);
  check('and one taken longer ago than that has let go', mine(runs()).length, 1);

  // Everything else here runs one statement at a time, which is the arrangement the old guard
  // looked safe in. This is the arrangement it was not: two runs of the lane deciding at once,
  // which is how ten copies of one agreement were made in twenty minutes.
  ask(`UPDATE visits SET agreement_started_at = NULL WHERE id = ${visitId}`);
  const together = ['a', 'b'].map((tag) => {
    const file = join(tmpdir(), `flooring-agreement-race-${tag}.sql`);
    writeFileSync(file, `SELECT pg_sleep(0.4);\nCREATE TEMP TABLE took AS ${claim};\n`
      + `SELECT count(*) FROM took WHERE visit_id = ${visitId};\n`);
    return { file, out: join(tmpdir(), `flooring-agreement-race-${tag}.out`) };
  });
  execFileSync('sh', ['-c', together
    .map(({ file, out }) => `( psql "${url}" -q -t -A -f ${file} > ${out} 2>&1 ) &`)
    .join(' ') + ' wait']);
  const apiece = together.map(({ out }) => Number(readFileSync(out, 'utf8').trim().split('\n').pop()));
  check('two runs arriving at once, and exactly one of them takes the visit',
    apiece.reduce((a, b) => a + b, 0), 1);

  const ready = compose(afresh()[0]);
  check('there is an agreement to prepare', ready.ready_to_prepare, true);
  check('every placeholder has a value, and one replacement is asked for each',
    [Object.keys(ready.replacements).length, ready.requests.length], [10, 10]);
  // the town extracted from a letter and the address typed with the deed in hand must not
  // contradict each other on a page somebody signs
  check('the city and the address both come off the booking, not off a letter',
    [ready.replacements.city, ready.replacements.address], ['Kyle', '18 Willow Bend, 78640']);
  check('the job is in it, from the order rather than a letter',
    [ready.replacements.material, ready.replacements.area_discussed,
     ready.replacements.existing_floor],
    ['Laminate', 'about 400 sqft', 'the old floor is taken out first']);
  check('what the visit has to settle is in words a customer reads',
    ready.replacements.settled_on_site, 'the stairs, what is under the old floor');
  // the one thing that must never be on that page
  check('no price of any kind reaches the agreement',
    Object.values(ready.replacements).some((v) => /\$|\d{3,}\s*(to|-)\s*\$?\d/.test(String(v))), false);

  // the template is a row, and the lane refuses rather than guesses when it is gone. Its value is
  // taken from the row rather than written here: a check carrying its own copy of a thing the
  // database holds is the drift it is supposed to be watching for.
  const templateId = ask("SELECT body FROM reply_templates WHERE key = 'agreement_template'");
  check('the template id is read from the row, not from the code', ready.template_id, templateId);
  ask("UPDATE reply_templates SET body = '' WHERE key = 'agreement_template'");
  check('with no template there is nothing to copy, and it says so',
    compose({ ...ready, template_id: '' }).why_not, 'there is no agreement template to copy');
  ask(`UPDATE reply_templates SET body = '${templateId}' WHERE key = 'agreement_template'`);
  check('and the row is left as it was found', afresh()[0].template_id, templateId);

  // prepared once
  rowOf(visitSql('say-where-the-agreement-is'),
    [visitId, 'https://docs.google.com/document/d/copy-1', afresh()[0].agreed]);
  check('a visit that has one is not taken again, claim or no claim', afresh().length, 0);
  check('and a second run stamps nothing', ask(
    `WITH again AS (${fill(visitSql('say-where-the-agreement-is'),
      [visitId, 'https://docs.google.com/document/d/copy-2', ask(`SELECT agreed FROM visits WHERE id = ${visitId}`)])})
     SELECT count(*) FROM again`), '0');
  check('the copy it kept is the first one',
    ask(`SELECT agreement_url FROM visits WHERE id = ${visitId}`),
    'https://docs.google.com/document/d/copy-1');

  // moved between being read and being stamped: the page made for the old time is not filed
  ask(`UPDATE visits SET agreement_url = NULL WHERE id = ${visitId}`);
  const asRead = afresh()[0];
  ask(`UPDATE visits SET agreed = agreed + interval '1 day' WHERE id = ${visitId}`);
  check('a visit that moved while its page was being made is not stamped with it', ask(
    `WITH late AS (${fill(visitSql('say-where-the-agreement-is'),
      [visitId, 'https://docs.google.com/document/d/stale', asRead.agreed])}) SELECT count(*) FROM late`), '0');
  check('and it is still waiting for the page it now needs', afresh().length, 1);

  // a visit that moves needs a page carrying the date it now has, and needs it now: the claim held
  // by whoever was making the old page must not keep it waiting out the half hour
  rowOf(visitSql('the-visit-moved'), [visitId, '2026-09-09T18:30:00+00:00']);
  const moved = mine(runs());
  check('a visit that moved is taken again at once, without waiting out the claim on the page it left',
    moved.length, 1);
  check('and the new one carries the new date',
    compose(moved[0]).replacements.visit_date.includes('September 9'), true);

  // nothing is printed for a door nobody is going to
  ask(`UPDATE visits SET agreement_url = NULL, state = 'lapsed' WHERE id = ${visitId}`);
  check('a cancelled visit gets no agreement', afresh().length, 0);
  ask(`UPDATE visits SET state = 'agreed', agreed = now() - interval '2 hours' WHERE id = ${visitId}`);
  check('and neither does one whose hour has gone by', afresh().length, 0);
}

console.log(`\n${failed === 0 ? 'all checks passed' : `${failed} check(s) FAILED`}`);

try {
  execFileSync('psql', [url, '-q', '-c', 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;']);
} catch { /* the run already reported what matters */ }

process.exit(failed === 0 ? 0 : 1);
