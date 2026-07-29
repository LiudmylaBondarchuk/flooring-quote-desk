# Changelog

The version here is the repository's. It is a **different axis** from the version
stamps written into every processed email (`workflow_version`, `prompt_version`,
`extraction_schema_version`): those say which logic handled one specific message,
this says what changed between releases. Never sync the two.

## 0.2.0

A conversation now outlives the email that started it, the price list is kept by the
owner rather than by a developer, and a price is computed and written down. Nothing
is sent to anyone yet.

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
made of comes from the order. Only active bands are priced. The offer is a draft,
and nothing in that lane can reach a customer.

**What was a known boundary and is no longer.** Area units are read from the words
the customer wrote and converted, so a job given in square metres is priced. Job
records spanning several emails are the orders layer above. Both were listed in
0.1.0 as things left undone.

**Still true, and deliberate.** Nothing reaches a customer. Four of the six lanes
accept the handoff and stop. An enquiry asking for the old floor to be taken away
cannot be priced automatically, because the note about it colours the message and
`pricing_allowed` requires green — a decision about which reasons are doubts and
which are notes, not a defect to patch quietly.

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
