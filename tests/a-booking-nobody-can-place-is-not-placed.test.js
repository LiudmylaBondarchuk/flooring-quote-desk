// "Nobody is guessed at" is one of the six things this desk must never do, and the statement that
// decides whose job a booking belongs to has always said when it could not tell. Nothing read it.
// The flag was computed and the lane ran straight past it into the update and the insert, so a
// booking the desk had already judged unplaceable was placed anyway.
//
// This checks the wiring rather than the words: that the path from deciding to writing passes
// through something that reads the flag, and that the branch which does not write says so to
// somebody.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const wf = JSON.parse(readFileSync(join(root, 'workflows', '25-visits.json'), 'utf8'));
const by = new Map(wf.nodes.map((n) => [n.name, n]));

const goesTo = (from) => (wf.connections[from]?.main || []).flatMap((b) => (b || []).map((l) => l.node));

test('deciding whose job it is leads to something that reads whether anybody is sure', () => {
  const next = goesTo('Whose job is this');
  assert.equal(next.length, 1, `it fans out to ${next.length} places instead of one gate`);

  const gate = by.get(next[0]);
  assert.equal(gate.type, 'n8n-nodes-base.if', `"${next[0]}" is not a gate`);
  assert.match(JSON.stringify(gate.parameters), /needs_a_person/,
    'the gate after the decision does not read needs_a_person');
});

test('the branch that writes is the one where nobody needs asking', () => {
  const gate = by.get(goesTo('Whose job is this')[0]);
  const [sure, unsure] = wf.connections[gate.name].main;

  // the gate is written as "needs_a_person is false", so the first branch is the ordinary one
  const operation = gate.parameters.conditions.conditions[0].operator.operation;
  assert.equal(operation, 'false', 'the gate passes the case that needs a person into the writing branch');

  assert.deepEqual(sure.map((l) => l.node), ['Remember where the job is']);
  assert.ok(unsure.length, 'the case that needs a person goes nowhere at all');
});

test('the other branch reaches somebody rather than stopping', () => {
  const gate = by.get(goesTo('Whose job is this')[0]);
  const unsure = wf.connections[gate.name].main[1].map((l) => l.node);

  const reached = [];
  const walk = (name, depth = 0) => {
    if (depth > 4 || reached.includes(name)) return;
    reached.push(name);
    for (const next of goesTo(name)) walk(next, depth + 1);
  };
  unsure.forEach((n) => walk(n));

  assert.ok(reached.some((n) => by.get(n)?.type === 'n8n-nodes-base.slack'),
    `the branch that cannot place a booking reaches ${reached.join(' → ')} and tells nobody`);
  assert.ok(!reached.some((n) => /Write the booked visit/.test(n)),
    'the branch that cannot place a booking writes a visit anyway');
});
