import { readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const base = process.env.N8N_BASE_URL;
const key = process.env.N8N_API_KEY;
if (!base || !key) {
  console.error('N8N_BASE_URL and N8N_API_KEY must be set (see .env.example)');
  process.exit(1);
}

const SETTINGS_ALLOWED = ['saveExecutionProgress', 'saveManualExecutions', 'saveDataErrorExecution',
  'saveDataSuccessExecution', 'executionTimeout', 'errorWorkflow', 'timezone', 'executionOrder'];

const api = async (path, init = {}) => {
  const res = await fetch(`${base}/api/v1${path}`, {
    ...init,
    headers: { 'X-N8N-API-KEY': key, 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${init.method || 'GET'} ${path} → ${res.status} ${body.message || ''}`);
  return body;
};

const localFile = (path) => (existsSync(join(root, path)) ? readFileSync(join(root, path), 'utf8') : null);

// Deploying carries four kinds of node body and nothing else: code, a statement with its
// parameters, an input schema, a system message. Everything else a node is made of -- which rule a
// switch matches on, what a branch tests, who an email goes to, what a trigger accepts -- lives
// only where somebody typed it. An export can therefore describe a node the instance does not have
// and no check notices, because the drift check compares the same four fields.
//
// This does not push those. Deciding to would mean deploying could quietly rewire a canvas. It
// says they differ, which is the part that was missing.
const CARRIED = new Set(['jsCode', 'query', 'inputSchema', 'content',
  'options.queryReplacement', 'options.systemMessage']);

const differences = (mine, theirs, trail = '') => {
  const out = [];
  const keys = new Set([...Object.keys(mine || {}), ...Object.keys(theirs || {})]);
  for (const key of keys) {
    const path = trail ? `${trail}.${key}` : key;
    if (CARRIED.has(path)) continue;
    const a = (mine || {})[key];
    const b = (theirs || {})[key];
    const both = (v) => v && typeof v === 'object' && !Array.isArray(v);
    if (both(a) && both(b)) { out.push(...differences(a, b, path)); continue; }
    if (JSON.stringify(a) !== JSON.stringify(b)) out.push(path);
  }
  return out;
};

// The exports carry credential names and no ids, on purpose. A node being created here therefore
// has to be told which stored credential it means, and the instance is the only place that knows:
// whichever node is already using that name has the id. Read once, and only if something asks.
let inUse = null;
const credentialByName = async (kind, name) => {
  if (!inUse) {
    inUse = new Map();
    const all = await api('/workflows?limit=100');
    for (const listed of all.data) {
      const full = await api(`/workflows/${listed.id}`);
      for (const node of (full.activeVersion || full).nodes) {
        for (const [k, cred] of Object.entries(node.credentials || {})) {
          if (cred.id) inUse.set(`${k}:${cred.name}`, cred.id);
        }
      }
    }
  }
  return inUse.get(`${kind}:${name}`);
};

const promptBody = (path) => {
  const text = localFile(path);
  return text === null ? null : text.split('\n---\n').slice(1).join('\n---\n').trim();
};

const only = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const adopt = process.argv.includes('--adopt');

// There is one instance and there are many branches, and deploying is indifferent to which one it
// is standing on. A branch that predates a lane's newest nodes will push its own older version of
// them over the top, and the lane goes on running -- quieter, wronger, and without an error
// anywhere. It happened twice in one day: once to a statement that had stopped recording a column,
// and once nearly to a canvas that had just been rewired.
//
// So the tool asks git rather than trusting whoever is at the keyboard to remember. --anyway is for
// the case that is genuinely deliberate, and being a word makes it a decision.
if (!process.argv.includes('--anyway')) {
  const { execFileSync } = await import('node:child_process');
  const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  let behind = null;
  try {
    git('fetch', '--quiet', 'origin', 'main');
    behind = Number(git('rev-list', '--count', 'HEAD..origin/main'));
  } catch {
    // A rule that cannot tell whether it applies has to say so. Guessing "probably fine" here is
    // the same guess that put an older statement onto a live lane.
    console.error('git could not say how this branch stands against origin/main, so this cannot');
    console.error('tell whether deploying would push something older than what is live.');
    console.error('Fix that, or pass --anyway if you know what you are doing.');
    process.exit(1);
  }
  if (behind > 0) {
    const branch = git('rev-parse', '--abbrev-ref', 'HEAD');
    console.error(`refused — ${branch} is ${behind} commit(s) behind origin/main.`);
    console.error('');
    console.error('There is one instance. Deploying from here would push this branch\'s version of');
    console.error('every shared lane over what is live, including the parts of it that were merged');
    console.error('after this branch was cut. Nothing would report an error.');
    console.error('');
    console.error('  git checkout main && git pull    then deploy');
    console.error('  or merge main into this branch first');
    console.error('  or --anyway, if pushing the older version is the point');
    process.exit(1);
  }
}

let changed = 0;
const outOfReach = [];
for (const file of readdirSync(join(root, 'workflows')).filter((f) => f.endsWith('.json'))) {
  if (only.length && !only.some((want) => file.startsWith(want))) continue;
  const exported = JSON.parse(readFileSync(join(root, 'workflows', file), 'utf8'));
  const id = process.env[`WF_${file.replace(/\W/g, '_').toUpperCase()}`];
  const all = await api('/workflows?limit=100').then((r) => r.data);
  const live = all.find((w) => w.name === exported.name);
  if (!live) {
    console.log(`skipped ${file} — no workflow named "${exported.name}" on the instance`);
    continue;
  }

  const scope = file.replace(/\.json$/, '');
  const full = await api(`/workflows/${id || live.id}`);
  const nodes = full.activeVersion ? full.activeVersion.nodes : full.nodes;
  const connections = full.activeVersion ? full.activeVersion.connections : full.connections;

  // Until now this only replaced the bodies of nodes the instance already had, so a node that
  // existed here and not there was deployed by doing nothing at all -- the query file sat in the
  // repository looking finished while the lane it belonged to had no such step. A node the export
  // has and the instance does not is created, and its credentials are matched by name against what
  // is already in use, because the export deliberately carries no credential ids.
  const known = new Map();
  for (const node of nodes) {
    if (node.credentials) {
      for (const [kind, cred] of Object.entries(node.credentials)) {
        if (cred.id) known.set(`${kind}:${cred.name}`, cred.id);
      }
    }
  }
  const already = new Set(nodes.map((n) => n.name));
  const brought = exported.nodes.filter((n) => !already.has(n.name));
  for (const node of brought) {
    if (node.credentials) {
      for (const [kind, cred] of Object.entries(node.credentials)) {
        const id = cred.id || known.get(`${kind}:${cred.name}`)
          || await credentialByName(kind, cred.name);
        if (!id) {
          console.error(`refused ${file} — "${node.name}" wants the ${kind} credential `
            + `"${cred.name}", and no node on this instance uses it, so there is no id to give it. `
            + 'Create it in n8n first, or bind it there by hand.');
          process.exit(1);
        }
        cred.id = id;
      }
    }
    nodes.push(node);
  }
  // Only the edges the new nodes need. Assigning the export's connections wholesale looked like a
  // merge and was not: it replaces a source node's whole list, so any edge drawn on the canvas
  // since the last export would vanish the next time anything was added. An edge is copied here
  // only when one of its ends is a node that did not exist a moment ago; everything else on the
  // instance is left exactly as the canvas has it.
  if (brought.length) {
    const fresh = new Set(brought.map((n) => n.name));
    for (const [from, byKind] of Object.entries(exported.connections)) {
      const live = connections[from] || (connections[from] = {});
      // every kind of wire, not only main: a model reaches an agent through ai_languageModel and a
      // parser through ai_outputParser, and an agent deployed without those is an agent with no
      // model. This read `groups.main` and skipped the rest, which would have been discovered live.
      for (const [kind, groups] of Object.entries(byKind || {})) {
        if (!Array.isArray(groups)) continue;
        const here = live[kind] || (live[kind] = []);
        groups.forEach((group, i) => {
          for (const edge of group || []) {
            if (!fresh.has(from) && !fresh.has(edge.node)) continue;
            while (here.length <= i) here.push([]);
            const there = here[i].some((e) => e.node === edge.node && e.index === edge.index);
            if (!there) here[i].push(edge);
          }
        });
      }
    }
  }

  // The other direction, which deploying deliberately does not act on: removing a node is a
  // decision somebody makes, not a side effect of pushing a file. But it must not be invisible
  // either -- a placeholder left behind after its replacement was deployed sits on the canvas
  // looking like part of the lane, and the next export quietly copies it back into the repository.
  const inTheExport = new Set(exported.nodes.map((n) => n.name));
  const onlyLive = nodes.filter((n) => !inTheExport.has(n.name)).map((n) => n.name);
  if (onlyLive.length) {
    console.log(`note ${file} — the instance has ${onlyLive.length} node(s) this export does not: `
      + `${onlyLive.join(', ')}. Nothing was removed there and nothing was taken into the export; `
      + 'delete them in n8n if they are finished with, or pass --adopt to keep them.');
  }

  // The same blindness one level down, and it is worse. Adding a node between two others leaves the
  // old wire between them in place, so the work runs down both paths at once -- once through the
  // new node and once around it. That happened when the second reader was put between the gate and
  // the save, and every email would have been triaged twice.
  const strandedWires = [];
  for (const [from, byKind] of Object.entries(connections)) {
    const mine = exported.connections[from];
    for (const [kind, groups] of Object.entries(byKind || {})) {
      if (!Array.isArray(groups)) continue;
      groups.forEach((group, i) => {
        for (const edge of group || []) {
          const known = (mine?.[kind]?.[i] || []).some(
            (e) => e.node === edge.node && e.index === edge.index);
          if (!known) strandedWires.push(`${from} -> ${edge.node}`);
        }
      });
    }
  }
  if (strandedWires.length) {
    console.log(`note ${file} — the instance has ${strandedWires.length} wire(s) this export does `
      + `not: ${strandedWires.join(', ')}. Nothing was removed. A wire left beside a node that was `
      + 'meant to replace it runs the work down both paths at once.');
  }

  let touched = brought.length;
  const inExport = new Map(exported.nodes.map((n) => [n.name, n]));

  // what this run will leave behind, said out loud rather than left to be discovered live
  const stranded = [];
  for (const node of nodes) {
    const mine = inExport.get(node.name);
    if (!mine || brought.includes(node)) continue;
    const apart = differences(mine.parameters, node.parameters);
    if (apart.length) stranded.push(`${node.name}: ${apart.join(', ')}`);
  }
  if (stranded.length) outOfReach.push({ file, stranded });
  for (const node of nodes) {
    // A sticky note is the only documentation a person reads while looking at the canvas, and it
    // has no file of its own, so the export is its source. Without this it was the one thing here
    // that could not be corrected from the repository -- and the note on this very lane went on
    // saying nothing was sent from it after the sending was built.
    if (node.type === 'n8n-nodes-base.stickyNote') {
      // undefined means the export has nothing to say about this note; an empty string is a note
      // deliberately cleared, and truthiness cannot tell those apart
      const said = inExport.get(node.name)?.parameters?.content;
      if (said !== undefined && said !== node.parameters.content) {
        node.parameters.content = said;
        touched++;
      }
      continue;
    }
    if (node.parameters?.jsCode) {
      const src = localFile(join('src', scope, `${slug(node.name)}.js`));
      if (src !== null && src !== node.parameters.jsCode) { node.parameters.jsCode = src; touched++; }
    }
    if (node.parameters?.query) {
      const sql = localFile(join('db', scope, `${slug(node.name)}.sql`));
      if (sql !== null && sql.trimEnd() !== node.parameters.query.trimEnd()) {
        node.parameters.query = sql.trimEnd();
        touched++;
      }
      const paramsFile = localFile(join('db', scope, `${slug(node.name)}.params.json`));
      if (paramsFile) {
        const { queryReplacement } = JSON.parse(paramsFile);
        if (queryReplacement && queryReplacement !== node.parameters.options?.queryReplacement) {
          node.parameters.options = { ...(node.parameters.options || {}), queryReplacement };
          touched++;
        }
      }
    }
    if (node.parameters?.inputSchema) {
      const example = localFile(join('src', scope, `${slug(node.name)}.schema.json`));
      if (example !== null && example.trimEnd() !== node.parameters.inputSchema.trimEnd()) {
        node.parameters.inputSchema = example.trimEnd();
        touched++;
      }
    }
    if (node.parameters?.options?.systemMessage) {
      const prompt = promptBody(join('src', scope, `${slug(node.name)}.prompt.md`));
      if (prompt && prompt !== node.parameters.options.systemMessage.trim()) {
        node.parameters.options.systemMessage = prompt;
        touched++;
      }
    }
  }

  const settings = Object.fromEntries(
    Object.entries(full.settings || {}).filter(([k]) => SETTINGS_ALLOWED.includes(k)));

  // Which workflow catches this one's failures is part of what the lane is, not a preference
  // somebody set once in a browser. It lived only on the instance, and 70 Catalogue quietly had
  // none: everything that lane could fail at was recorded nowhere and told nobody. The export
  // names it rather than holding an id, the same way it names a credential.
  const catcher = exported.settings?.errorWorkflow;
  if (catcher) {
    const caught = live.name === catcher ? live : all.find((w) => w.name === catcher);
    if (!caught) {
      console.error(`refused ${file} — its failures are meant to reach "${catcher}", `
        + 'and no workflow on this instance has that name.');
      process.exit(1);
    }
    if (settings.errorWorkflow !== caught.id) { settings.errorWorkflow = caught.id; touched++; }
  }

  if (!touched) { console.log(`unchanged ${file}`); continue; }

  await api(`/workflows/${full.id}`, {
    method: 'PUT',
    body: JSON.stringify({ name: full.name, nodes, connections, settings }),
  });
  const fresh = await api(`/workflows/${full.id}`);
  const freshVersion = fresh.activeVersion || fresh;
  for (const node of freshVersion.nodes) {
    if (node.credentials) for (const k of Object.keys(node.credentials)) node.credentials[k].id = null;
  }
  const keptSettings = { ...(fresh.settings || { executionOrder: 'v1' }) };
  if (keptSettings.errorWorkflow) {
    const named = all.find((w) => w.id === keptSettings.errorWorkflow);
    if (named) keptSettings.errorWorkflow = named.name;
  }

  // The refresh takes back what the instance made of what it was sent -- ids, positions, fields a
  // newer n8n added -- but only for nodes this export named. It used to take everything, which made
  // the note above a lie: it said a stranded node had been left alone, and then wrote it into the
  // export, so the next deploy created it again. That happened twice, and the second time a renamed
  // branch node came back to life beside its replacement and quietly ran the work down both paths.
  //
  // Adopting a node built in the canvas is a thing somebody decides, so it has a word for it. This
  // file is the only writer of workflows/*.json; without --adopt there would be no way in at all.
  const keep = adopt ? () => true : (name) => inTheExport.has(name);
  const keptNodes = freshVersion.nodes.filter((n) => keep(n.name));
  const keptConnections = {};
  for (const [from, byKind] of Object.entries(freshVersion.connections)) {
    if (!keep(from)) continue;
    keptConnections[from] = Object.fromEntries(Object.entries(byKind).map(([kind, groups]) =>
      [kind, (groups || []).map((g) => (g || []).filter((e) => keep(e.node)))]));
  }

  writeFileSync(join(root, 'workflows', file), JSON.stringify({
    name: fresh.name,
    nodes: keptNodes,
    connections: keptConnections,
    settings: keptSettings,
  }, null, 2) + '\n');

  console.log(`deployed ${file} — ${touched} node(s), export refreshed`);
  changed += touched;
}

console.log(changed ? `done, ${changed} node(s) updated` : 'nothing to deploy');

// Last, so it is the thing still on the screen. These are differences this run could not push and
// did not push: change them in n8n, or take them out of the export, but do not assume deploying
// has dealt with them. A switch rule that stayed here and never reached the instance sent every
// owner reply to the error lane for as long as it took to notice.
if (outOfReach.length) {
  console.error('\nThese differ between the export and the instance in ways deploying cannot carry:');
  for (const { file, stranded } of outOfReach) {
    console.error(`  ${file}`);
    for (const line of stranded) console.error(`    ${line}`);
  }
  console.error('\nDeploying pushes node bodies only. Anything above was left as the instance has it.');
  process.exitCode = 1;
}


