# Changelog

The version here is the repository's. It is a **different axis** from the version
stamps written into every processed email (`workflow_version`, `prompt_version`,
`extraction_schema_version`): those say which logic handled one specific message,
this says what changed between releases. Never sync the two.

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
