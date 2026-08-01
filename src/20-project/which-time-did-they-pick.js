// Which of the times we offered the customer meant, if any.
//
// Three times went out numbered, so most replies are a digit and nothing else. The rest are prose,
// and prose is where this must be careful: reading "not the 2nd, but the 3rd works" as a vote for
// two would put somebody's van outside a house on the wrong morning.
//
// The rule is that a reply must name exactly one of the times and nothing that argues with it.
// Anything else -- two numbers, none, a refusal, a new time of their own -- goes to a person. There
// is no cost to being wrong in that direction; the owner reads one more email. The cost the other
// way is a wasted drive and a customer who was told a time nobody wrote down.

// "one" is missing from the first of these on purpose. It is a pronoun far more often than a
// number -- "the second one please" names the second time and mentions the word one -- and reading
// both made that reply ambiguous and sent it to a person. Nobody picking the first time writes
// "one" alone; they write 1 or first.
const ORDINALS = [
  [1, /\b(1|first|1st)\b/i],
  [2, /\b(2|two|second|2nd)\b/i],
  [3, /\b(3|three|third|3rd)\b/i],
  [4, /\b(4|four|fourth|4th)\b/i],
  [5, /\b(5|five|fifth|5th)\b/i],
];

// A reply that turns all three down often names one on the way past -- "tuesday is no good" -- so
// a refusal has to win over a number rather than being outvoted by it.
const REFUSES = /\bnone\b|neither|no good|don'?t work|doesn'?t work|do not work|does not work|can'?t (do|make)|cannot (do|make)|unable to make|another (time|day|week)|different (time|day)|any other/i;

// and a reply proposing its own time is an answer to a different question than the one asked
const PROPOSES = /\bhow about\b|\bwhat about\b|\binstead\b|\bcould you (do|come)\b|\bwould (\w+ )?work\b|\bany chance\b/i;

const asked = (text) => {
  const said = String(text || '');
  if (!said.trim()) return { picked: null, why: 'the reply had no words in it' };
  if (REFUSES.test(said)) return { picked: null, why: 'the reply turns the times down' };
  if (PROPOSES.test(said)) return { picked: null, why: 'the reply proposes a time of its own' };

  const named = ORDINALS.filter(([, pattern]) => pattern.test(said)).map(([n]) => n);
  if (named.length === 0) return { picked: null, why: 'the reply names none of the times' };
  if (named.length > 1) {
    return { picked: null, why: `the reply names ${named.join(' and ')} — it cannot be read as one` };
  }
  return { picked: named[0], why: null };
};

return $input.all().map((item, i) => {
  const row = item.json || {};
  const offered = Array.isArray(row.offered) ? row.offered
    : (typeof row.offered === 'string' ? JSON.parse(row.offered) : []);

  // no open offer on this job: a reply about times when nobody offered any is a person's problem,
  // not a lookup that quietly matches the wrong visit
  if (!row.visit_id || !offered.length) {
    return {
      json: { ...row, agreed: null, agreed_index: null, needs_a_person: true,
        why_not: 'there is no open offer of times on this job' },
      pairedItem: { item: i },
    };
  }

  const { picked, why } = asked(row.body);
  const withinRange = picked !== null && picked <= offered.length;

  return {
    json: {
      ...row,
      agreed: withinRange ? offered[picked - 1] : null,
      agreed_index: withinRange ? picked : null,
      needs_a_person: !withinRange,
      why_not: withinRange ? null
        : (why || `the reply names ${picked}, and only ${offered.length} times were offered`),
    },
    pairedItem: { item: i },
  };
});
