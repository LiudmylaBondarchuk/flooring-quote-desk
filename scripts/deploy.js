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

let changed = 0;
for (const file of readdirSync(join(root, 'workflows')).filter((f) => f.endsWith('.json'))) {
  if (only.length && !only.some((want) => file.startsWith(want))) continue;
  const exported = JSON.parse(readFileSync(join(root, 'workflows', file), 'utf8'));
  const id = process.env[`WF_${file.replace(/\W/g, '_').toUpperCase()}`];
  const live = await api(`/workflows?limit=100`).then((r) =>
    r.data.find((w) => w.name === exported.name));
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
    for (const [from, groups] of Object.entries(exported.connections)) {
      if (!groups?.main) continue;
      const live = connections[from] || (connections[from] = { main: [] });
      groups.main.forEach((group, i) => {
        for (const edge of group || []) {
          if (!fresh.has(from) && !fresh.has(edge.node)) continue;
          while (live.main.length <= i) live.main.push([]);
          const there = live.main[i].some((e) => e.node === edge.node && e.index === edge.index);
          if (!there) live.main[i].push(edge);
        }
      });
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
      + `${onlyLive.join(', ')}. Nothing was removed; delete them in n8n if they are finished with.`);
  }

  let touched = brought.length;
  const inExport = new Map(exported.nodes.map((n) => [n.name, n]));
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

  if (!touched) { console.log(`unchanged ${file}`); continue; }

  const settings = Object.fromEntries(
    Object.entries(full.settings || {}).filter(([k]) => SETTINGS_ALLOWED.includes(k)));
  await api(`/workflows/${full.id}`, {
    method: 'PUT',
    body: JSON.stringify({ name: full.name, nodes, connections, settings }),
  });
  const fresh = await api(`/workflows/${full.id}`);
  const freshVersion = fresh.activeVersion || fresh;
  for (const node of freshVersion.nodes) {
    if (node.credentials) for (const k of Object.keys(node.credentials)) node.credentials[k].id = null;
  }
  writeFileSync(join(root, 'workflows', file), JSON.stringify({
    name: fresh.name,
    nodes: freshVersion.nodes,
    connections: freshVersion.connections,
    settings: fresh.settings || { executionOrder: 'v1' },
  }, null, 2) + '\n');

  console.log(`deployed ${file} — ${touched} node(s), export refreshed`);
  changed += touched;
}

console.log(changed ? `done, ${changed} node(s) updated` : 'nothing to deploy');


