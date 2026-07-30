# Changelog

The version here is the repository's. It is a **different axis** from the version
stamps written into every processed email (`workflow_version`, `prompt_version`,
`extraction_schema_version`): those say which logic handled one specific message,
this says what changed between releases. Never sync the two.

## 0.2.0

A conversation now outlives the email that started it, the price list is kept by the
owner rather than by a developer, and a price is computed and written down. The desk
answers a customer for the first time — with a question, never with a figure.

**A job is a job, not a piece of paper.** An email joins an open order in its own
thread, or opens one when it is the kind of email that starts work; the database
holds one open order per thread through a partial unique index rather than through
hope. Facts accumulate across messages, every value carries the message it came
from, and every overwrite leaves the old one behind. A customer who names the
material in one email and the area in the next is not asked for either twice.

**The gate says separately what it reports and what it stands behind.** Colour
answers where an email goes and who looks at it; whether a number can be a floor is
a fact about the number. Conflating the two cost a hole in each direction on the
same day — an implausible area settling into an order mid-conversation, and an
ordinary "laminate, size to follow" contributing nothing because incomplete is also
red. The merge now reads one object the gate assembled, and nothing else.

**The price list lives in a spreadsheet.** It is copied into the catalogue as a
single statement: whole or not at all, never half. A row that leaves the sheet is
switched off rather than deleted, keeps its id and its history, and comes back if it
is pasted in again. A read that returns nothing changes nothing, because a broken
connection looks exactly like an emptied sheet. What the sheet may contain is read
out of the database's own constraints rather than written down a second time.

**A price is computed from the order and recorded.** The three fields that decide
whether it may be quoted come from the message in hand; everything the price is
made of comes from the order. Only active bands are priced. The offer is a draft, and
no number leaves the lane.

**What was a known boundary and is no longer.** Area units are read from the words
the customer wrote and converted, so a job given in square metres is priced. Job
records spanning several emails are the orders layer above. Both were listed in
0.1.0 as things left undone.

**The gate says when a person must look first, and the lane listens.** It had always worked out
whether an email may be acted on unread, used the answer to decide whether a price could be
quoted, and then dropped it. Harmless while nothing was sent; not harmless once the desk began
answering, because the only permission the sending step could see was the one on the wording, and
a sentence is the same sentence whoever receives it. A commercial enquiry, which the gate marks
never-auto, and an email changing payment details, which it says to verify by phone, both got an
automatic reply. Nothing leaked — the letter asks for square footage and carries no figure — but
the verdict was being ignored. The message now carries `auto_blocked`, both permissions must hold
before a letter goes out alone, and the database refuses a row that is priced and held at once.
Deliberately narrower than red: an enquiry that has simply not given the area yet is red and is
exactly the one worth answering, because asking is the point.

**Still true, and deliberate.** No figure reaches a customer. Four of the six lanes
accept the handoff and stop. An enquiry asking for the old floor to be taken away
cannot be priced automatically, because the note about it colours the message and
`pricing_allowed` requires green — a decision about which reasons are doubts and
which are notes, not a defect to patch quietly.

**The system knows what to ask, and asks it once.** An order that is missing the
material, the area or the town says so, and the question that goes out names only
what is outstanding. Asking is recorded like any other event, and the decision to
ask reads that history rather than a flag: a second email adding nothing gets no
second copy of the same question, while a customer who answers half of it is asked
for the rest, in different words. What the firm says is stored in the database, so
changing how it sounds is an edit rather than a deployment, and a combination with
no sentence written for it is refused rather than sent empty.

**And the question is now actually sent, on the sentence's own terms.** Each stored
sentence says whether it may go out unread; the column defaults to no, so a wording
added later cannot escape by omission. One marked yes is sent as a reply, which
leaves the subject and the thread to Gmail rather than inventing either, and the ask
is recorded only after the send returns — a question the customer never received must
not count as asked. One marked no is still composed: it goes to the owner, headed as
not sent and naming who it was for, and nothing is recorded, so the next email asks
again. Neither carries a number.

The address to answer used to be read from a node that does not return one, so every
real run would have refused for want of a recipient while a test that supplied the
field by hand passed. It comes back from the query that decides to speak, and the
harness can no longer hand in a field the running node would not have.

**A file could describe a step the system did not have.** Deploying only replaced the
bodies of nodes the instance already had, so a query written for a node nobody had
created was deployed by doing nothing — which is how the words above sat finished in
the repository while the lane had no step to say them. A node the export has and the
instance does not is now created, with its credential matched by name against what is
already in use.

**A letter from the desk's own mailbox is the desk's.** Gmail labels a message sent
to oneself with SENT and INBOX both, and the old test for outbound wanted SENT
without INBOX — so every reply the desk sent to the demo address came back as
though a customer had written it, landed in a lane, and grew the thread's history.
Nothing looped only because the lane it landed in does nothing yet. The sender's
address decides it now, whatever Gmail labelled it.

**Accepting needs something to accept.** A returning customer's first enquiry was
filed as agreeing to a quote that had never been sent, and routed to a lane that
does nothing, because "we're in Round Rock, TX" matched a pattern for assent and
the branch asked only whether the writer had been in touch before. Assent now
needs an offer to exist, and "we're in" is only agreement when the sentence ends
there — followed by a noun it is geography, and it no longer counts a line break
as the end of one, because an address wrapped onto the next line is the commonest
way that sentence appears in a letter. Which offer matters is now the one in this
exchange rather than any this contact has ever had: a customer quoted for a
bathroom last spring is not agreeing to that when they write about a bedroom now.

**Deploying says what it cannot carry.** It pushes four kinds of node body — code, a statement
with its parameters, an input schema, a system message — and nothing else. Which rule a switch
matches on, what a branch tests, who an email goes to, what a sub-workflow trigger accepts: those
live only where somebody typed them, and an export could describe a node the instance did not have
while the drift check called it *in sync*, because it compares the same four fields. That is not
theoretical — a routing rule that stayed in the repository sent every owner reply to the error lane
until it was noticed. Deploying now compares the whole of each node and names, last of all, every
difference it left behind, and the run reports itself as failed. It still does not push them:
deciding to would mean deploying could quietly rewire a canvas.

**An order that goes quiet is chased once, and then let go.** Silence is measured on the order
rather than on the inbox: one touched by a merge, a quote or an approval is a live conversation
whatever arrived. Past the first mark it gets one nudge, ever — in words a person wrote, carrying
no figure and repeating no question, because a customer who did not answer is not helped by being
asked the same thing again. Past the second it is closed, and **nothing is sent**: closing the
books is a decision about the desk's own records, and *we assume you are not interested* is the
letter that arrives the day somebody finally replies. The lane is off until somebody turns it on.

**A question about what the firm does gets an answer.** The gate had always worked out which
service an email was asking about and thrown the answer away, so *do you install laminate?* was
understood, categorised, routed — and never replied to. The message remembers the label now, one
column, and the answer stays in the services table where it can be edited: copying it onto the
message would make a second place for it to be wrong. A service the firm offers is answered and
then asked what a price would need; one it does not offer is answered and left there, because
asking for the square footage of a job just declined reads as not having listened. A question the
gate held for a person is not answered by itself.

**Whether a price may be quoted is a question about the job, not about the last email.** It was
read off the message being handled, and that made the conversation this system exists for
impossible to finish. A customer writes *laminate, kyle tx*, then *about 400 sq ft*; the second
letter names no town, so the gate colours it red and asks for one — while the order it belongs to
has had the town since the first. The order was complete and nothing could ever be priced. A live
run found it on the first real two-letter conversation, minutes after the approval round went in.

The permission is assembled from the order and from every message that has touched it: is the job
fully described, is it somewhere the firm works, is it still open, has nothing about it been held
for a person. One email being held holds the whole job — a commercial property does not stop being
one because the next letter is ordinary.

**And it closes the removal question**, which had been open for weeks: taking the old floor away is
a note about what will be charged, not a doubt about anything, but it put a reason on the message,
the message went yellow, pricing wanted green, and the arithmetic had a removal line and a rate it
could never reach. A note no longer blocks a price. Being incomplete, being out of area, and being
held for a person still do.

**The owner says send it, and the customer gets the price.** Her answer arrives as an ordinary
email from the desk's own address, which the router had always filed as *ours* and dropped. That
category has a lane now. Nearly everything reaching it is the desk reading its own letters, and
that is fine: it finds no offer waiting in that thread and stops. Two things must hold before a
figure reaches anybody — an offer is waiting in this very thread, and an assent was typed into
this very message, read from the body with quoted history stripped, because the letter she is
answering carries the whole quote underneath it.

What goes out is **the letter she read**, stored on the offer when it was put in front of her,
never a fresh calculation: the price list can move between the two moments and the wording is a
row somebody can edit. She approves a text, not a recipe for one. A refusal is recognised and
stops everything; the offer stays where it is. A second reply in the same thread sends nothing
twice.

**A price becomes a letter, and it only ever reaches the owner.** An offer had been a draft that
nothing did anything with. It is written out now — the job, every priced line with the rate it came
from, the range, wrapped in words a person wrote and stored — and it goes to the owner with the
customer's copy inside it, ready to read. The offer waits at `awaiting_approval` until somebody
answers, and telling her twice about the same figure cannot happen: only a draft moves.

Where it goes is not configurable. Every other letter here decides its destination from the stored
wording; this one is fixed in code, because a figure must not be one edit in a table away from
leaving unread. The customer's copy exists and is not sent. What sends it is an approval, and that
is the next thing to build.

**A failure reaches a person.** Failures have been recorded since the first schema and the node
at the end of that lane was called *TODO notify the maintainer* and did nothing, so every other
guarantee here quietly depended on somebody thinking to look at a table. The owner is written to
now — but one letter per quiet window rather than one per failure, because a workflow failing in
a loop would otherwise send a hundred, and a hundred is the same as none. The letter carries
everything still untold, grouped by workflow, node and message, so twelve identical timeouts are
one line with a count. A failure is marked as told only after Gmail returns; if sending fails the
rows stay untold and the next letter carries them. The gap, stated rather than hidden: the letter
goes when a failure arrives, so if failures stop inside the quiet window the last of them wait for
the next one — that sweep is the watchman's job, and the watchman is parked.

**The build notices when the repository disagrees with itself.** The drift check compared every
node to its file and never asked the question the other way round, so a query written for a node
nobody had created reported *in sync* -- which is how a finished-looking set of files sat in the
repository while the lane had no step to say them. A file under a workflow's folder with no node
behind it now fails the build. So does a statement whose `$1..$N` disagrees with the number of
arguments its parameters supply: those are bound by position, and when the two drift the database
is handed values for the wrong columns without anything raising an error. Both run in CI, and the
first was tried against the commit where the gap actually existed -- it names all five files.

**Checks, and what they are worth.** Four harnesses run against a real Postgres on
every push, one of them driving whole conversations — several customers at once with
interleaved threads, a returning customer whose first job was booked, a refused
message between two good ones. Every guard in them has been broken on purpose and
watched to fail. Two survived that and were tightened because of it. The rules that
decide whether a change may be pushed run in the build as well as locally, so they
hold for a clone and not only for one machine.

## 0.1.0

First public state of the intake router. It reads a mailbox, decides what each
message is, and hands it to the workflow that owns that kind of work. It sends
nothing to anyone.

**Extraction is constrained, not trusted.** The model returns facts with the exact
words each one came from, and the gate verifies those words are really in the email
before accepting anything. Ungrounded output may only ever make the system more
careful, never less: `is_commercial` can block an automatic reply, while
`is_flooring_inquiry` is not used at all, because it would move an email into the
revenue lane.

**Decisions are deterministic.** Category, lane, colour and eligibility for an
automatic answer are plain code with no model involvement, and every decision carries
the reasons that produced it.

**An automatic answer is only allowed for output that limits itself.** A quote can go
out automatically only when it states, in the message, what it is not priced for:
no removal, a sound subfloor, no stairs, a floating installation.

Known boundaries are written down in the backlog rather than hidden: area units, job
records spanning several emails, attachments that are downloaded but not read, and
the fact that four of the six lanes accept the handoff and stop there on purpose.
