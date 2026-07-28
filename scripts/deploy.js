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

  let touched = 0;
  for (const node of nodes) {
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


