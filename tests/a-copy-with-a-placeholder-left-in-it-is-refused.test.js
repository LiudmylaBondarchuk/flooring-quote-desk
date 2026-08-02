// The guard the agreement lane rests on, and until this existed nothing ran it.
//
// It is the only thing standing between the owner editing their own document and a customer being
// handed a page with {{material}} printed on it. Every other failure in that lane is loud — a copy
// that is not made, a stamp that does not land. This one is silent: the copy is made, the
// replacement finds no such text, and the page prints.
//
// Run here the way the node runs it, with $input and $() supplied, because the shape of those two
// is the thing that has already gone wrong once in this repository.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(join(root, 'src', '25-visits', 'did-every-placeholder-land.js'), 'utf8');

const asks = (names) => names.map((n) => ({
  replaceAllText: { containsText: { text: `{{${n}}}`, matchCase: true }, replaceText: 'x' },
}));

// what the node is given: the answers from Google, and the items the composer produced
const run = (answers, composed) => new Function('$input', '$', source)(
  { all: () => answers.map((json) => ({ json })) },
  (name) => {
    assert.equal(name, 'Write the agreement', `the node reached for "${name}"`);
    return {
      all: () => composed.map((json) => ({ json })),
      itemMatching: (i) => (composed[i] ? { json: composed[i] } : undefined),
    };
  },
);

const landed = (n) => ({ replaceAllText: { occurrencesChanged: n } });

test('a copy where every placeholder landed is passed on with its visit', () => {
  const out = run(
    [{ documentId: 'DOC1', replies: [landed(1), landed(1)] }],
    [{ visit_id: 7, order_id: 41, requests: asks(['material', 'city']) }],
  );

  assert.equal(out.length, 1);
  assert.equal(out[0].json.visit_id, 7);
  assert.equal(out[0].json.order_id, 41);
  assert.equal(out[0].json.filled, 2);
  assert.equal(out[0].json.agreement_url, 'https://docs.google.com/document/d/DOC1/edit');
});

test('a placeholder that changed nothing refuses the copy, and names it', () => {
  assert.throws(() => run(
    [{ documentId: 'DOC1', replies: [landed(1), landed(0)] }],
    [{ visit_id: 7, order_id: 41, requests: asks(['material', 'city']) }],
  ), /visit 7 .*1 placeholder\(s\) unfilled: \{\{city\}\}/s);
});

// Google leaves the count out of a reply entirely when nothing changed, so absent and nought have
// to mean the same thing. Reading `occurrencesChanged` without that would treat undefined as fine.
test('a reply with no count at all counts as nothing changed', () => {
  assert.throws(() => run(
    [{ documentId: 'DOC1', replies: [landed(1), { replaceAllText: {} }] }],
    [{ visit_id: 7, order_id: 41, requests: asks(['material', 'city']) }],
  ), /\{\{city\}\}/);
});

test('no replies at all is every placeholder unfilled, not a copy that is fine', () => {
  assert.throws(() => run(
    [{ documentId: 'DOC1', replies: [] }],
    [{ visit_id: 7, order_id: 41, requests: asks(['material', 'city']) }],
  ), /2 placeholder\(s\) unfilled/);
});

// The failure this repository has already had once, in another lane: a node written as though it
// handles one item, run over several. Two visits in one schedule and both copies are checked
// against the first one's placeholders and stamped onto the first one's visit.
// A gate stands between the composer and this, and a gate compacts: a visit that was second up
// there arrives first here. Pairing by position would hand it the other visit's placeholders and
// stamp its copy against the other visit's row.
test('a visit the gate moved forward is still judged against its own placeholders', () => {
  const composed = [{ visit_id: 7, order_id: 41, requests: asks(['material', 'city']) },
    { visit_id: 8, order_id: 42, requests: asks(['booking_code']) }];
  const ask = async () => {};
  const linked = (i) => ({ json: composed[i + 1] });      // the gate dropped the first one
  const out = new Function('$input', '$', readFileSync(
    join(root, 'src', '25-visits', 'did-every-placeholder-land.js'), 'utf8'))(
    { all: () => [{ json: { documentId: 'DOC-B', replies: [landed(1)] } }] },
    () => ({ all: () => composed.map((json) => ({ json })), itemMatching: linked }),
  );
  assert.equal(out[0].json.visit_id, 8, 'it took the visit at its own index rather than its own visit');
  assert.equal(out[0].json.filled, 1);
  void ask;
});

test('two visits in one run keep their own placeholders and their own visit', () => {
  const out = run(
    [{ documentId: 'DOC-A', replies: [landed(1), landed(1)] },
      { documentId: 'DOC-B', replies: [landed(1)] }],
    [{ visit_id: 7, order_id: 41, requests: asks(['material', 'city']) },
      { visit_id: 8, order_id: 42, requests: asks(['booking_code']) }],
  );

  assert.deepEqual(out.map((o) => o.json.visit_id), [7, 8]);
  assert.deepEqual(out.map((o) => o.json.order_id), [41, 42]);
  assert.deepEqual(out.map((o) => o.json.filled), [2, 1]);
  assert.deepEqual(out.map((o) => o.json.agreement_url), [
    'https://docs.google.com/document/d/DOC-A/edit',
    'https://docs.google.com/document/d/DOC-B/edit',
  ]);
});

test('the second visit is judged against its own placeholders, not the first visit\'s', () => {
  // the second copy filled its one placeholder; against the first visit's two it would look short
  assert.doesNotThrow(() => run(
    [{ documentId: 'DOC-A', replies: [landed(1), landed(1)] },
      { documentId: 'DOC-B', replies: [landed(1)] }],
    [{ visit_id: 7, order_id: 41, requests: asks(['material', 'city']) },
      { visit_id: 8, order_id: 42, requests: asks(['booking_code']) }],
  ));
});

// The address stamped against a visit has to be the document that was written to, not the one the
// lane asked to write to: a copy that silently landed elsewhere would be filed as this visit's.
test('the address kept is the one Google answered with', () => {
  const out = run(
    [{ documentId: 'WHATEVER-GOOGLE-SAID', replies: [landed(1)] }],
    [{ visit_id: 7, order_id: 41, requests: asks(['material']) }],
  );
  assert.match(out[0].json.agreement_url, /WHATEVER-GOOGLE-SAID/);
});
