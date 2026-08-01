// What the second reader said, folded back into the decision the code already made.
//
// One direction only. A reader that says the decision does not hold raises auto_blocked, which
// already exists and already sends the email to a person instead of answering it. A reader that
// says it holds changes nothing at all, and neither does one that says nothing usable: the code's
// decision stands in both cases.
//
// That asymmetry is the whole safety of this. Two models agreeing on a wrong answer is a real
// thing; this one can never turn a refusal into a permission, and it can never lower a hand the
// gate has already raised.

const decisions = $('Decision gate').all();

// The reader is asked after the model has already been paid for once, so its answer arrives in
// whatever shape the parser managed. Anything that is not one of the two words is treated as
// silence -- a reader that cannot make itself understood must not be able to stop the desk working.
const readVerdict = (raw) => {
  const said = raw && typeof raw === 'object' ? (raw.output || raw) : {};
  if (said.holds === true) return { opinion: 'holds', why: null };
  if (said.holds === false) {
    const why = String(said.why || '').trim();
    // the constraint refuses a raised hand with no reason, and it is right to: a hand raised
    // without one tells the owner to look at something and not what at
    return why
      ? { opinion: 'does_not_hold', why: why.slice(0, 400) }
      : { opinion: null, why: null };
  }
  return { opinion: null, why: null };
};

return $input.all().map((item, i) => {
  const decided = (decisions[i] || decisions[0] || {}).json || {};
  const { opinion, why } = readVerdict(item.json);

  return {
    json: {
      ...decided,
      second_opinion: opinion,
      second_opinion_why: why,
      // never `opinion === 'holds' ? false : ...` -- a hand the gate raised stays raised
      auto_blocked: decided.auto_blocked === true || opinion === 'does_not_hold',
    },
    pairedItem: { item: i },
  };
});
