// Whether every placeholder in the copy was actually filled.
//
// The document is the owner's and they edit it. Rename {{material}} in it, or delete the line it
// sits on, and nothing anywhere fails: the copy is made, the replacement finds no such text, and a
// customer is handed a page with {{material}} printed on it, or with a fact silently missing from
// it. That is the failure this exists for, and it is invisible from every other angle.
//
// Google answers a batch of replacements with one reply each, saying how many occurrences it
// changed. Nought means the placeholder this asked for is not in that document.

const asked = $('Write the agreement').item.json.requests || [];
const wanted = asked.map((r) => r.replaceAllText.containsText.text);

return $input.all().map((item, i) => {
  const answer = item.json || {};
  const replies = Array.isArray(answer.replies) ? answer.replies : [];

  // A reply carries no count at all when nothing changed, so absent and nought are the same thing.
  const landed = replies.map((r) => Number(r?.replaceAllText?.occurrencesChanged || 0));
  const missing = wanted.filter((_, n) => !(landed[n] > 0));

  if (missing.length) {
    throw new Error(`the agreement for visit ${$('Write the agreement').item.json.visit_id} was `
      + `copied with ${missing.length} placeholder(s) unfilled: ${missing.join(', ')}. `
      + 'Either the template no longer contains them, or they are spelled differently in it. '
      + 'The copy is on Drive and is not fit to print.');
  }

  return {
    json: {
      ...answer,
      visit_id: $('Write the agreement').item.json.visit_id,
      order_id: $('Write the agreement').item.json.order_id,
      filled: wanted.length,
    },
    pairedItem: { item: i },
  };
});
