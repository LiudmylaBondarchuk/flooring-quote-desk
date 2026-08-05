// What a person said about a booking, read off the line they were asked on.
//
// A tick and a cross, and nothing else counts. Slack lets anybody put anything on a message, and
// the ones that mean something here were named in the message itself -- so a thumbs up, a shrug or
// somebody's joke leaves the booking exactly where it was, waiting, which is the honest answer to
// "I do not know what that meant".
//
// Both at once is not an answer either. Two people can disagree, or one can change their mind by
// adding rather than removing, and acting on whichever was read first would make the outcome depend
// on the order Slack happened to list them in.
//
// No answer is the ordinary case: this runs every couple of minutes and most of the time nobody has
// looked yet. Dropping the item is what "not yet" looks like.

const YES = 'white_check_mark';
const NO = 'x';

return $input.all().flatMap((item, i) => {
  const said = item.json || {};
  const waiting = $('Which answers are we waiting on').itemMatching(i)?.json || {};

  if (said.ok !== true) {
    throw new Error(`Slack would not say what is on that message: ${said.error || 'no reason given'}`);
  }

  const names = (said.message?.reactions || []).map((r) => r.name);
  const yes = names.includes(YES);
  const no = names.includes(NO);
  if (yes === no) return [];

  return [{
    json: { ...waiting, she_agreed: yes, state_was: waiting.state_was },
    pairedItem: { item: i },
  }];
});
