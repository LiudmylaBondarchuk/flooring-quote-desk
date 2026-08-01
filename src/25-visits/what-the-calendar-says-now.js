// What the calendar says about visits this database still believes in.
//
// Bookings move and bookings vanish, and neither arrives as a message anybody sends us. A customer
// presses "reschedule" on Google's own page and the desk is told nothing; the owner deletes a
// morning from her calendar and the desk is told nothing. Either way the row here goes on naming a
// time nobody is coming at, which is worse than knowing nothing: it reads as certainty.
//
// This compares the two rather than trusting a trigger to say what changed. Which events Google
// emits for a reschedule -- one updated, or a cancelled and a created -- is not something this has
// to know, and not knowing it is the point: a comparison is right whatever the notification did.

const CANCELLED = 'cancelled';

return (() => {
  const believed = $('Visits worth checking').all().map((item) => item.json || {});
  if (!believed.length) return [];

  const live = new Map();
  for (const item of $input.all()) {
    const event = item.json || {};
    if (event.id) live.set(event.id, event);
  }

  const verdicts = [];
  for (const [i, visit] of believed.entries()) {
    const event = live.get(visit.booked_event_id);

    // Not in the window we asked for is not the same as cancelled. The read covers a stretch of
    // time; a visit outside it is simply unmentioned, and calling that a cancellation would strike
    // out every booking far enough ahead.
    if (!event) continue;

    if (event.status === CANCELLED) {
      verdicts.push({ json: { ...visit, what_changed: 'gone', now_at: null }, pairedItem: { item: i } });
      continue;
    }

    const now_at = event.start?.dateTime || null;
    if (!now_at) continue;

    // compared as instants, because the two sides write the same moment differently: the database
    // hands back +00:00 and Google says -05:00, and as strings those never agree
    const same = new Date(now_at).getTime() === new Date(visit.agreed).getTime();
    if (!same) {
      verdicts.push({ json: { ...visit, what_changed: 'moved', now_at }, pairedItem: { item: i } });
    }
  }
  return verdicts;
})();
