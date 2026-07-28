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

console.log('\nnothing leaked between any of them');
{
  const orders = Number(ask('SELECT count(*) FROM orders'));
  const threads = Number(ask('SELECT count(DISTINCT thread_id) FROM orders'));
  check('every order belongs to one thread and every thread to one order', orders, threads);
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
