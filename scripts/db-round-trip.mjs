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

const run = (args, input) =>
  execFileSync('psql', [url, '-q', ...args], { input, encoding: 'utf8' });

const ask = (sql) => execFileSync('psql', [url, '-t', '-A', '-c', sql], { encoding: 'utf8' }).trim();

const existing = ask("SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'");
if (existing !== '0') {
  console.error(`refusing to run: CHECK_DATABASE_URL already holds ${existing} tables in public.`);
  console.error('it must be empty and disposable — never the database holding real data.');
  process.exit(1);
}

const read = (...p) => readFileSync(join(root, ...p), 'utf8');

const params = (path) => {
  const body = JSON.parse(read(path)).queryReplacement.replace(/^=\{\{\s*/, '').replace(/\s*\}\}$/, '');
  return new Function('$json', '$', `return ${body}`);
};

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

const columnOfPlaceholder = (sql) =>
  new Map([...sql.matchAll(/^\s{2}(\w+)\s+=\s+\$(\d+)/gm)].map((m) => [Number(m[2]), m[1]]));

const gateKeys = (sql, path) => {
  const columns = columnOfPlaceholder(sql);
  const body = JSON.parse(read(path)).queryReplacement.replace(/^=\{\{\s*\[/, '').replace(/\]\s*\}\}$/, '');
  const parts = body.split(/,\s*(?![^(]*\))/).map((x) => x.trim());
  const pairs = [];
  for (const [position, column] of columns) {
    const match = parts[position - 1] && parts[position - 1].match(/\$json\.(\w+)/);
    if (match) pairs.push([column, match[1]]);
  }
  return pairs;
};

const prepareSource = read('src', '00-intake-router', 'prepare-fields.js');
const gateSource = read('src', '00-intake-router', 'decision-gate.js');
const runNode = (source, items) =>
  new Function('$input', source)({ all: () => items.map((json) => ({ json })) });

const logSql = read('db', '00-intake-router', 'log-inbound-dedupe.sql');
const logParams = params(join('db', '00-intake-router', 'log-inbound-dedupe.params.json'));
const triageSql = read('db', '00-intake-router', 'save-triage.sql');
const triageParams = params(join('db', '00-intake-router', 'save-triage.params.json'));
const lookupSql = read('db', '00-intake-router', 'lookup-geo-catalogue-history.sql');
const lookupParams = params(join('db', '00-intake-router', 'lookup-geo-catalogue-history.params.json'));
const fromPreparedNode = (prepared) => () => ({ item: { json: prepared } });

const message = (over = {}) => ({
  id: 'transport',
  threadId: 't-1',
  labelIds: ['INBOX'],
  from: { value: [{ address: 'someone@example.com', name: 'Someone' }] },
  text: 'Hi, I need laminate in the hallway, 210 sq ft, Buda TX.',
  html: '',
  headers: {},
  ...over,
});

const TRANSPORT = [
  ['an ordinary inbound email', message()],
  ['a lead forwarded by a platform, with a reply-to', message({
    from: { value: [{ address: 'leads@mail.angi.com', name: 'Angi' }] },
    headers: { 'reply-to': 'customer@example.com' },
  })],
  ['a lead from a platform with no reply-to at all', message({
    from: { value: [{ address: 'leads@mail.thumbtack.com', name: 'Thumbtack' }] },
  })],
  ['a message Gmail gave no thread for', message({ threadId: undefined })],
  ['an email that says Auto-Submitted: no', message({ headers: { 'auto-submitted': 'no' } })],
  ['an out of office reply', message({ headers: { 'auto-submitted': 'auto-replied' } })],
  ['an email the owner sent', message({ labelIds: ['SENT'] })],
  ['an email with no sender address at all', message({ from: { value: [{}] } })],
  ['an html-only email', message({ text: '', html: '<p>Carpet in the bedroom, 180 sq ft, Kyle TX.</p>' })],
  ['an email quoting a rival price in dollars', message({
    text: 'I was quoted $1,200 by another company for 320 sq ft of LVP in Austin TX. Can you beat that?',
  })],
];

const cases = JSON.parse(read('tests', 'fixtures', 'decision-gate.json'));

const failures = [];
const decisions = [];
let stored = '0';
let refusedCount = 0;

try {
  run(['-v', 'ON_ERROR_STOP=1', '-f', join(root, 'db', 'schema.sql'),
    '-f', join(root, 'db', 'seeds', 'reference-data.sql')]);

  const services = JSON.parse(ask(
    `SELECT coalesce(json_agg(json_build_object('label', label, 'we_do', we_do,
       'match_words', match_words, 'answer', answer) ORDER BY priority), '[]') FROM services`));

  const DEFAULTS = {
    categories: ['Carpet', 'LVP', 'Laminate', 'Vinyl', 'Wood'],
    services,
    body_empty: false, body_fully_quoted: false, has_photo: false, is_outbound: false,
    needs_sender_extraction: false, list_unsubscribe: false,
    prior_in_thread: 0, prior_from_contact: 0, prior_offers: 0, prior_signatures: [],
  };

  const script = [];
  const labels = [];
  const step = (stage, name, sql) => {
    labels.push({ stage, name });
    script.push(`\\warn CASE ${labels.length - 1}`, sql.replace(/;\s*$/, '') + ';');
  };

  TRANSPORT.forEach(([name, m], i) => {
    const [item] = runNode(prepareSource, [{ ...m, id: `transport-${i}` }]);
    step('storing the email', name, fill(logSql, logParams(item.json)));
  });

  cases.forEach(({ name, row }, i) => {
    const id = `gate-${i}`;
    const [inbound] = runNode(prepareSource, [message({ id, threadId: `t-${i}` })]);
    step('storing the email', name, fill(logSql, logParams(inbound.json)));
    step('looking up geography, catalogue and history', name,
      fill(lookupSql, lookupParams({ output: row.extracted || {} }, fromPreparedNode(inbound.json))));
    const [decided] = runNode(gateSource, [{ ...DEFAULTS, ...row, gmail_message_id: id }]);
    decisions.push({ id, name, json: decided.json });
    step('storing the decision', name, fill(triageSql, triageParams(decided.json)));
  });

  let output = '';
  try {
    output = execFileSync('sh', ['-c', 'psql "$0" -q -f - 2>&1', url],
      { input: script.join('\n') + '\n', encoding: 'utf8' });
  } catch (e) {
    output = String(e.stdout || '') + String(e.stderr || '');
  }

  let current = null;
  for (const line of output.split('\n')) {
    const marker = line.match(/^CASE (\d+)$/);
    if (marker) { current = Number(marker[1]); continue; }
    const problem = line.match(/(?:ERROR|FATAL):\s+(.*)$/);
    if (problem) {
      failures.push({ ...(labels[current] || { stage: 'before any case ran', name: '' }), error: problem[1] });
    }
  }

  stored = ask('SELECT count(*) FROM messages');
  const expected = TRANSPORT.length + cases.length;
  if (Number(stored) !== expected) {
    failures.push({ stage: 'counting what survived', name: '',
      error: `${expected} emails went in, ${stored} came out — a statement was accepted and stored nothing` });
  }

  const undecided = ask("SELECT count(*) FROM messages WHERE gmail_message_id LIKE 'gate-%' AND status = 'new'");
  if (Number(undecided) !== 0) {
    failures.push({ stage: 'counting what survived', name: '',
      error: `${undecided} decisions matched no row — those emails would keep their untriaged defaults` });
  }

  const pairs = gateKeys(triageSql, join('db', '00-intake-router', 'save-triage.params.json'));
  const columns = pairs.map(([column]) => `'${column}', ${column}`).join(', ');
  const back = new Map(JSON.parse(ask(
    `SELECT coalesce(json_agg(json_build_object('id', gmail_message_id, ${columns})), '[]')
       FROM messages WHERE gmail_message_id LIKE 'gate-%'`))
    .map((r) => [r.id, r]));

  const canonical = (v) => {
    if (Array.isArray(v)) return v.map(canonical);
    if (v && typeof v === 'object') {
      return Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical(v[k])]));
    }
    return v;
  };

  const same = (stored, meant) => {
    if (stored === null || stored === undefined) return meant === null || meant === undefined;
    if (typeof meant === 'object') return JSON.stringify(canonical(stored)) === JSON.stringify(canonical(meant));
    if (typeof meant === 'number' || typeof stored === 'number') return Number(stored) === Number(meant);
    return String(stored) === String(meant);
  };

  decisions.forEach(({ id, name, json }) => {
    const row = back.get(id);
    if (!row) return;
    for (const [column, key] of pairs) {
      if (!same(row[column], json[key])) {
        failures.push({ stage: 'reading the decision back', name,
          error: `${column} holds ${JSON.stringify(row[column])}, the gate decided ${key} = ${JSON.stringify(json[key])}` });
      }
    }
  });

  const LANES = [['10-quote', 'awaiting_pricing'], ['20-project', 'awaiting_owner'],
                 ['30-support', 'awaiting_owner'], ['40-operations', 'digest_pending'],
                 ['50-review', 'awaiting_manual_review']];

  const laneScript = [];
  const laneLabels = [];
  LANES.forEach(([dir], i) => {
    const id = `lane-${i}`;
    const [inbound] = runNode(prepareSource, [message({ id, threadId: `lane-t-${i}` })]);
    laneLabels.push(dir);
    laneScript.push(`\\warn LANE ${laneLabels.length - 1}`,
      fill(logSql, logParams(inbound.json)).replace(/;\s*$/, '') + ';');
    const take = params(join('db', dir, 'accept-handoff.params.json'));
    laneLabels.push(dir);
    laneScript.push(`\\warn LANE ${laneLabels.length - 1}`,
      fill(read('db', dir, 'accept-handoff.sql'), take({ gmail_message_id: id })).replace(/;\s*$/, '') + ';');
  });

  const failureSql = read('db', '90-errors', 'record-failure.sql');
  const failureParams = params(join('db', '90-errors', 'record-failure.params.json'));
  laneLabels.push('90-errors');
  laneScript.push(`\\warn LANE ${laneLabels.length - 1}`, fill(failureSql, failureParams({
    source: 'router_lane', workflow_name: '00 Intake & Router — Flooring', workflow_id: 'wf',
    execution_id: '1', node_name: 'Save triage', message: 'a check constraint refused the write',
    gmail_message_id: 'lane-0', payload: { error: { name: 'NodeOperationError' } },
  })).replace(/;\s*$/, '') + ';');

  let laneOut = '';
  try {
    laneOut = execFileSync('sh', ['-c', 'psql "$0" -q -f - 2>&1', url],
      { input: laneScript.join('\n') + '\n', encoding: 'utf8' });
  } catch (e) { laneOut = String(e.stdout || '') + String(e.stderr || ''); }

  let lane = null;
  for (const line of laneOut.split('\n')) {
    const marker = line.match(/^LANE (\d+)$/);
    if (marker) { lane = Number(marker[1]); continue; }
    const problem = line.match(/(?:ERROR|FATAL):\s+(.*)$/);
    if (problem) failures.push({ stage: 'handing over to a lane', name: laneLabels[lane] || '', error: problem[1] });
  }

  const stamped = JSON.parse(ask(`SELECT coalesce(json_agg(json_build_object(
      'id', gmail_message_id, 'by', handled_by, 'status', status)), '[]')
    FROM messages WHERE gmail_message_id LIKE 'lane-%'`));
  LANES.forEach(([dir, expected], i) => {
    const row = stamped.find((r) => r.id === `lane-${i}`);
    if (!row || !row.by) {
      failures.push({ stage: 'handing over to a lane', name: dir, error: 'the handover updated no row' });
    } else if (row.status !== expected) {
      failures.push({ stage: 'handing over to a lane', name: dir,
        error: `left the message in ${row.status}, the lane is supposed to set ${expected}` });
    }
  });

  const refusedSql = read('db', '00-intake-router', 'say-the-write-was-refused.sql');
  const refusedParams = params(join('db', '00-intake-router', 'say-the-write-was-refused.params.json'));

  const awkward = [
    ['a decision that was green and priceable', (d) => d.pricing_allowed === true],
    ['a decision nobody was meant to open', (d) => d.handling === 'none'],
    ['a decision flagged as fraud', (d) => d.danger === true],
    ['a decision with fields the gate left empty', (d) => d.material_category === null],
  ];

  const refusedScript = [];
  const refusedLabels = [];
  const refusedTargets = [];
  for (const [name, pick] of awkward) {
    const target = decisions.find(({ json }) => pick(json));
    if (!target) {
      failures.push({ stage: 'refusing a write', name,
        error: 'no fixture reaches this state, so the fallback is untested against it' });
      continue;
    }
    refusedTargets.push({ name, id: target.id });
    refusedLabels.push(name);
    const errorItem = { message: 'violates check constraint "messages_handling_known"' };
    const values = refusedParams(errorItem, () => ({ item: { json: { gmail_message_id: target.id } } }));
    refusedScript.push(`\\warn REFUSED ${refusedLabels.length - 1}`,
      fill(refusedSql, values).replace(/;\s*$/, '') + ';');
  }

  let refusedOut = '';
  try {
    refusedOut = execFileSync('sh', ['-c', 'psql "$0" -q -f - 2>&1', url],
      { input: refusedScript.join('\n') + '\n', encoding: 'utf8' });
  } catch (e) { refusedOut = String(e.stdout || '') + String(e.stderr || ''); }

  let refused = null;
  for (const line of refusedOut.split('\n')) {
    const marker = line.match(/^REFUSED (\d+)$/);
    if (marker) { refused = Number(marker[1]); continue; }
    const problem = line.match(/(?:ERROR|FATAL):\s+(.*)$/);
    if (problem) {
      failures.push({ stage: 'refusing a write', name: refusedLabels[refused] || '',
        error: `the fallback was itself refused: ${problem[1]}` });
    }
  }

  const afterRefusal = new Map(JSON.parse(ask(`SELECT coalesce(json_agg(json_build_object(
      'id', gmail_message_id, 'category', category, 'route', route, 'handling', handling,
      'colour', gate_color, 'priceable', pricing_allowed, 'reasons', gate_reasons)), '[]')
    FROM messages WHERE gmail_message_id IN (${refusedTargets.map((r) => literal(r.id)).join(', ') || "''"})`))
    .map((r) => [r.id, r]));

  refusedCount = refusedTargets.length;

  for (const { name, id } of refusedTargets) {
    const row = afterRefusal.get(id);
    if (!row) {
      failures.push({ stage: 'refusing a write', name, error: 'the fallback updated no row at all' });
      continue;
    }
    const meant = { category: 'unknown', route: 'review', handling: 'manual_review',
      colour: 'red', priceable: false };
    for (const [column, value] of Object.entries(meant)) {
      if (String(row[column]) !== String(value)) {
        failures.push({ stage: 'refusing a write', name,
          error: `${column} is ${JSON.stringify(row[column])}, a refused write must leave it ${JSON.stringify(value)}` });
      }
    }
    const reason = (row.reasons || [])[0] || '';
    if (!/could not be stored/.test(reason) || !/check constraint/.test(reason)) {
      failures.push({ stage: 'refusing a write', name,
        error: `the row says ${JSON.stringify(reason)} — it must name the constraint that rejected the write` });
    }
  }

  const runFallback = (sql) => {
    const line = ask(sql.replace(/;\s*$/, '')).trim();
    if (!line) return null;
    const [gmail_message_id, _error, _node, rows] = line.split('|');
    return { gmail_message_id, _error, _node, rows_updated: Number(rows) };
  };

  if (refusedTargets.length) {
    const probe = refusedTargets[0];
    const reason = 'violates check constraint "messages_handling_known"';
    const probeSql = fill(refusedSql, refusedParams({ message: reason },
      () => ({ item: { json: { gmail_message_id: probe.id } } }))).replace(/;\s*$/, '');
    const row = runFallback(probeSql);
    const returned = row ? [row] : [];

    if (!returned.length) {
      failures.push({ stage: 'attributing the failure', name: probe.name,
        error: 'the fallback returned no row, so the error lane is handed nothing to attribute' });
    } else {
      const normalise = read('src', '90-errors', 'normalise-failure.js');
      const [normalised] = runNode(normalise, returned);
      run(['-c', fill(failureSql, failureParams(normalised.json))]);

      const attributed = JSON.parse(ask(`SELECT coalesce(json_agg(json_build_object(
          'id', gmail_message_id, 'message', message, 'node', node_name)), '[]')
        FROM failures WHERE gmail_message_id = ${literal(probe.id)}`));
      if (!attributed.length) {
        failures.push({ stage: 'attributing the failure', name: probe.name,
          error: 'the failure was recorded against no email — nobody can tell which one was refused' });
      } else if (!/check constraint/.test(attributed[0].message)) {
        failures.push({ stage: 'attributing the failure', name: probe.name,
          error: `the failure says ${JSON.stringify(attributed[0].message)} rather than naming the constraint` });
      } else if (!attributed[0].node) {
        failures.push({ stage: 'attributing the failure', name: probe.name,
          error: 'the failure names no node — the error lane takes input from eight places ' +
                 'and cannot say which of them died' });
      }
    }
  }

  if (Number(ask('SELECT count(*) FROM failures')) !== 2) {
    failures.push({ stage: 'recording a failure', name: '',
      error: `the error lane holds ${ask('SELECT count(*) FROM failures')} rows, two were written` });
  }
} finally {
  try {
    execFileSync('psql', [url, '-q', '-c', 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;']);
  } catch { /* the run already failed; leaving the schema is the lesser problem */ }
}

if (failures.length) {
  console.error(`${failures.length} statement(s) the database would not accept:\n`);
  for (const f of failures) console.error(`  [${f.stage}] ${f.name}\n      ${f.error}`);
  process.exit(1);
}

console.log(`round trip passed: ${TRANSPORT.length} transport cases and ${cases.length} decisions ` +
  `went through the real SQL, ${stored} rows stored and read back unchanged, ` +
  `all six lanes and the error lane exercised, and a refused write survived ${refusedCount} awkward states.`);
console.log('the values go in as literals here; n8n binds them as query parameters, so driver-level ' +
  'type conversion is not covered by this check.');
