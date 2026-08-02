// Whether every placeholder in the copy was actually filled.
//
// The document is the owner's and they edit it. Rename {{material}} in it, or delete the line it
// sits on, and nothing anywhere fails: the copy is made, the replacement finds no such text, and a
// customer is handed a page with {{material}} printed on it, or with a fact silently missing from
// it. That is the failure this exists for, and it is invisible from every other angle.
//
// Google answers a batch of replacements with one reply each, saying how many occurrences it
// changed. Nought means the placeholder this asked for is not in that document.

// Paired by position, never by $('...').item. This node runs over every waiting visit at once, and
// a linked item is one item: two visits in a run would both be checked against the first one's
// placeholders and both stamped against the first one's visit. Position is what pairs them, because
// the copy and the fill preserve the order the statement returned.
const prepared = $('Write the agreement').all();

return $input.all().map((item, i) => {
  const answer = item.json || {};
  const mine = prepared[i]?.json || {};
  const wanted = (mine.requests || []).map((r) => r.replaceAllText.containsText.text);
  const replies = Array.isArray(answer.replies) ? answer.replies : [];

  // A reply carries no count at all when nothing changed, so absent and nought are the same thing.
  const landed = replies.map((r) => Number(r?.replaceAllText?.occurrencesChanged || 0));
  const missing = wanted.filter((_, n) => !(landed[n] > 0));

  if (missing.length) {
    throw new Error(`the agreement for visit ${mine.visit_id} was `
      + `copied with ${missing.length} placeholder(s) unfilled: ${missing.join(', ')}. `
      + 'Either the template no longer contains them, or they are spelled differently in it. '
      + 'The copy is on Drive and is not fit to print.');
  }

  // The address of the copy, built from the id Google answered with rather than from anything this
  // lane carried in: what is stamped against the visit has to be the document that was actually
  // written to, not the one it was asked to write to.
  return {
    json: {
      ...answer,
      visit_id: mine.visit_id,
      order_id: mine.order_id,
      // carried through so the stamp can refuse a visit that moved while this was being made
      agreed: mine.agreed,
      filled: wanted.length,
      agreement_url: `https://docs.google.com/document/d/${answer.documentId}/edit`,
    },
    pairedItem: { item: i },
  };
});
