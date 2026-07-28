import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sha = (s) => createHash('sha256').update(s).digest('hex');
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const workflowFiles = readdirSync(join(root, 'workflows')).filter((f) => f.endsWith('.json'));

const codeNodes = [];
const promptNodes = [];
for (const file of workflowFiles) {
  const wf = JSON.parse(readFileSync(join(root, 'workflows', file), 'utf8'));
  for (const node of wf.nodes) {
    if (node.parameters?.jsCode) codeNodes.push({ file, node });
    if (node.parameters?.options?.systemMessage) promptNodes.push({ file, node });
  }
}

test('the export contains workflows to check', () => {
  assert.ok(workflowFiles.length >= 6, `only ${workflowFiles.length} workflow files found`);
  assert.ok(codeNodes.length >= 3, `only ${codeNodes.length} Code nodes across all workflows`);
});

for (const { file, node } of codeNodes) {
  test(`${node.name} (${file}) runs the same bytes as the deployed workflow`, () => {
    const path = join(root, 'src', file.replace(/\.json$/, ''), `${slug(node.name)}.js`);
    assert.ok(existsSync(path),
      `Code node "${node.name}" in ${file} has no file in src/ — run \`npm run extract\``);
    assert.equal(sha(readFileSync(path, 'utf8')), sha(node.parameters.jsCode),
      `src/${slug(node.name)}.js differs from the jsCode inside ${file}. ` +
      'Run `npm run extract` after exporting from n8n.');
  });
}

test('the export contains a prompt to check', () => {
  assert.ok(promptNodes.length >= 1, 'no prompt found in any workflow');
});

for (const { file, node } of promptNodes) {
  test(`${node.name} (${file}) sends exactly the prompt on disk`, () => {
    const path = join(root, 'src', file.replace(/\.json$/, ''), `${slug(node.name)}.prompt.md`);
    assert.ok(existsSync(path),
      `"${node.name}" in ${file} has no prompt file — run \`npm run extract\``);
    const body = readFileSync(path, 'utf8').split('\n---\n').slice(1).join('\n---\n').trim();
    assert.equal(body, node.parameters.options.systemMessage.trim(),
      `src/prompts/${slug(node.name)}.md is not exactly what "${node.name}" sends. ` +
      'A file holding two revisions cannot tell you which one is live.');
  });
}
