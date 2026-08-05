# Anatomy of the system — node by node

Written 2 August 2026, updated 5 August. Assembled from the repository's own files: the
`workflows/*.json` exports (which is where the exact node names, types, triggers and wires come
from), the code in `src/<lane>/*.js`, the statements in `db/<lane>/*.sql` and `db/schema.sql`.
Nothing here is recalled from memory, and nothing is checked against the live database — this
document was never connected to production.

**State at the time of the update.** `main`, commit `fcd1cb0`. The previous edition was written at
`d6d0442`; over the thirteen commits since, lane 60 stopped sending letters itself, the letter
carrying a price became a draft with a booking link in it, lanes 75 and 85 appeared, and branch F
was added to lane 25.

From the previous edition: at `d6d0442` the "a page is made exactly once" branch was **closed
completely** — step (a), claiming a visit before copying anything
(`claim-the-visits-that-need-an-agreement.sql`, migration 42); step (b), comparing the time to the
millisecond, and the fixture that had been agreeing with the bug. The lane runs as
`ask → CLAIM → compose → copy → fill → check → stamp`.

The first edition of this document was written on an unmerged branch and described the millisecond
defect as live. That was corrected at `d6d0442`.

---

## How to read this

Each lane is described by three questions — what wakes it · the chain · what it depends on in the
database and what it changes — and then each node by six:

1. the exact node name and type
2. what arrives as input
3. what it does
4. what it passes on
5. what happens if it fails
6. what protects against that, and **where exactly**

Where there is no protection, it says so. Those are the most valuable places in this document, and
they are gathered into a section of their own at the end.

**n8n settings, in shorthand:** `onError=continueErrorOutput` — the node has a second, "red" output,
and an error goes there instead of stopping the run. `onError=continueRegularOutput` — the error
goes out of the ordinary output. `alwaysOutputData` — the node emits an empty item rather than
nothing. `retryOnFail` — n8n repeats the node itself.

---

## Map of the lanes

```
                    Gmail (every minute)
                            │
                    ┌───────▼────────┐
                    │ 00 Intake &    │  reads the letter, extracts facts,
                    │    Router      │  decides the category, opens a job,
                    └───────┬────────┘  merges the facts
                            │
        ┌──────────┬────────┼────────┬──────────┬─────────┐
        ▼          ▼        ▼        ▼          ▼         ▼
     10 Quote  20 Project  30/40/50  60 Approval  99 log  90 Errors
        │          │                    │                    ▲
        │          │ invitation         │ recognises that a  │
        │          ▼                    │ price went out     │
        │   Google Calendar             │                    │
        │          │                    │                    │
        │   ┌──────▼──────┐             │                    │
        └──►│ 25 Visits   │◄────────────┘        every lane ─┘
            └─────────────┘
              │        ▲
              │ a booking made with the code from the letter carrying the price
              └────────┘

     70 Catalogue  ──► price_bands   (every morning 06:00, webhook, by hand)
     75 Chase      ──► drafts never sent: twice at six hours, then the job is closed
     85 Morning    ──► what today and tomorrow hold (06:00 Texas time)

     65 Reminders  ✖ off        80 Watchman  ✖ off
```

`30 Support`, `40 Operations` and `50 Review` accept a handoff and do nothing else — one
`Accept handoff` node each.

**Whether a lane is switched on is not kept in the files.** The `active` field is not set in any
export; that 65 and 80 are off is a property of the n8n instance, not of this repository. As of
5 August: `75 Chase` is live and active, `85 Morning` is **not deployed**.

---

# Lane 00 — Intake & Router

File: `workflows/00-intake-router.json`, 36 nodes.
Settings: `executionOrder=v1`, `binaryMode=separate`, `errorWorkflow="90 Errors — Flooring"`.

## What wakes it

A `Gmail Trigger`, polling **every minute**. It is the only way mail gets into the system. There is
no scheduler here, and no other lane calls it.

## The chain

```
Gmail Trigger
   └─► Prepare fields
          └─► Technical error? ──true──► → 90 Errors (intake)
                    └──false──► Log inbound (dedupe) ──error──► → 90 Errors (intake)
                                   └─► Already processed? ──true──► Duplicate - already handled ▪
                                             └──false──► Has text to read?
                                                   ├──true──►  Skip extraction (no text) ──┐
                                                   └──false──► AI extract ──error──► → 90 Errors (extraction)
                                                                    └────────────────────┤
                                                                                         ▼
                                                            Lookup geo, catalogue, history ──error──► → 90 Errors (extraction)
                                                                    └─► Decision gate
                                                                          └─► What the second reader is asked
                                                                                └─► Second reader
                                                                                      └─► Fold in the second opinion
                                                                                            └─► Save triage ──error──► Say the write was refused
                                                                                                  └─► Was the decision stored?
                                                                                                        ├──no──► → 50 Review + → 90 Errors (storage)
                                                                                                        └──yes─► Find or create an order ──error──► → 90 Errors (routing)
                                                                                                                       └─► Merge the facts ──error──► → 90 Errors (routing)
                                                                                                                             └─► Route by type
```

`Route by type` sorts on `route`: `quote`→10, `project`→20, `support`→30, `operations`→40,
`review`→50, `approval`→60, `log`→99 Log only, **fallback**→90 Errors (routing).

## What it depends on in the database, and what it changes

**Reads:** `service_area` (zone by postcode and by town), `price_bands` (which categories are
active), `services` (what the firm does and does not do), `messages` (the history of the thread and
of the contact), `orders` (the thread's open job), `order_events` (what has happened to it).

**Writes:** `messages` — a row on arrival, then the whole of the gate's decision;
`orders` — opens a job and merges facts into it;
`order_events` — `created`, `merged`, `corrected`.

---

## The nodes of lane 00

### 1. `Gmail Trigger`

1. **Type:** `n8n-nodes-base.gmailTrigger` v1.2.
2. **Input:** the Gmail API. Polls `everyMinute`, filter
   `-label:receipts -label:newsletters -label:private`, `simple=false` (the whole message).
3. **Does:** collects new mail from the mailbox.
4. **Passes on:** `id`, `threadId`, `messageId`, `from`, `to`, `subject`, `text`, `html`,
   `headers`, `labelIds`, `date`, `sizeEstimate`, plus binary attachments.
5. **If it fails:** Gmail unreachable, and the run never starts. A letter the polling missed is not
   read again: the next run takes only what is new.
6. **Protection:** none in the node itself. At workflow level `errorWorkflow` points at 90 Errors,
   but a trigger that did not fire raises no error. **The only thing that would have caught this was
   80 Watchman ("nothing has arrived for N hours"), and it is switched off.**

### 2. `Prepare fields`

1. **Type:** `n8n-nodes-base.code` v2 — `src/00-intake-router/prepare-fields.js`.
2. **Input:** the raw message from the trigger.
3. **Does**, in order:
   - `OUR_MAILBOX` is a constant. `isOutbound` is true when the sender is us **or** when the labels
     carry `SENT` without `INBOX`. The comment says why it is written that way: Gmail puts both
     `SENT` and `INBOX` on a letter the desk sends itself, so the rule "SENT and not INBOX" would
     read the desk's own letter as a customer's, and the lane would answer itself;
   - `PLATFORM` — Angi, HomeAdvisor, Thumbtack, Yelp and the rest. For a platform, the customer's
     address is taken from `reply-to`, and only when that is not itself a platform address;
     otherwise `contact_email = null` and `needs_sender_extraction` goes up;
   - the body: `text` where there is one, otherwise `html` through `htmlToText` (which strips
     script and style, makes line breaks out of `<br>` and block tags, and decodes entities);
   - `dropPlaceholders` removes `[image: …]`, `[cid: …]`, `[attachment: …]`;
   - `stripQuote` cuts quoted history by six patterns (`>`, "On … wrote:", the Polish
     "napisał(a)", the Ukrainian "написав(-ла)", the German "schrieb", the Spanish "escribió",
     `--- Original Message`, `______`, `From:/Sent:`). If nothing is left after the cutting,
     `body_fully_quoted=true` and `body_clean` becomes the whole body again;
   - `cleanSubject` strips `[EXTERNAL]`, `[SPAM]` and the `Re:/Fwd:/Odp:/AW:` prefixes in a loop,
     until the subject stops changing;
   - counts attachments by MIME: `image_count`, `pdf_count`, `has_photo`;
   - `nothing_to_read` — the body is empty **and** the cleaned subject is empty.
4. **Passes on:** about thirty fields, among them `gmail_message_id`, `internet_message_id`,
   `thread_id`, `is_outbound`, `contact_email`, `from_name`, `source`
   (`owner_sent`/`platform`/`gmail_direct`), `needs_sender_extraction`, `subject`,
   `subject_normalized`, `nothing_to_read`, `body_raw`, `body_html`, `body_clean`, `body_empty`,
   `body_fully_quoted`, `has_photo`, `image_count`, `pdf_count`, `auto_submitted`, `precedence`,
   `list_unsubscribe`, `raw_email`, `contract_version`.
5. **If it fails:** any parsing error — at minimum a missing `m.id` — is caught, and an object with
   `_error` on it is returned rather than the lane falling over.
6. **Protection:** `try/catch` around the whole body, plus the next node `Technical error?`, which
   reads `_error`. One mechanism across two files.

### 3. `Technical error?`

1. **Type:** `n8n-nodes-base.if` v2.2.
2. **Input:** everything from `Prepare fields`; looks only at `$json._error` (operation `exists`).
3. **Does:** separates the letter that was parsed from the one that was not.
4. **Passes on:** true → `→ 90 Errors (intake)`; false → `Log inbound (dedupe)`.
5. **If it fails:** an IF does not fail.
6. **Protection:** it is the protection.

### 4. `Log inbound (dedupe)`

1. **Type:** `n8n-nodes-base.postgres` v2.6, `executeQuery`, `onError=continueErrorOutput`,
   `retryOnFail`. Statement — `db/00-intake-router/log-inbound-dedupe.sql`, 23 parameters.
2. **Input:** every field from `Prepare fields`, by position (see the `.params.json`).
3. **Does:** `INSERT INTO messages (...) ON CONFLICT (gmail_message_id) DO NOTHING` in a `ins` CTE,
   then `SELECT … (SELECT count(*) FROM ins) = 0 AS was_duplicate`. The row is written with
   `status='new'` **before anything has been decided** — which is exactly what makes `status='new'`
   the fingerprint of every later breakage.
4. **Passes on:** `gmail_message_id`, `was_duplicate`.
5. **If it fails:** the database is unreachable — `retryOnFail` repeats, then the red output leads
   to 90 Errors. **Two identical events are impossible:** the unique key on `gmail_message_id` turns
   a redelivery into `was_duplicate=true`.
6. **Protection:** `ON CONFLICT DO NOTHING` plus `UNIQUE` on `messages.gmail_message_id` in
   `db/schema.sql`, plus the node's red output.

### 5. `Already processed?` / 6. `Duplicate - already handled`

1. **Type:** `if` v2.2 / `noOp` v1.
2. **Input:** `was_duplicate`.
3. **Does:** stops a redelivery quietly.
4. **Passes on:** true → noOp (the end); false → `Has text to read?`.
5. **If it fails:** —
6. **Protection:** it is the protection against handling the same letter twice.

### 7. `Has text to read?` / 8. `Skip extraction (no text)`

1. **Type:** `if` v2.2 / `code` v2 (`src/00-intake-router/skip-extraction-no-text.js`).
2. **Input:** `$('Prepare fields').item.json.nothing_to_read`.
3. **Does:** a letter with nothing readable in it is not given to the model — nobody pays for that,
   and nobody invents facts for it. The code returns `{ output: {}, skipped_extraction: true }`.
4. **Passes on:** both branches meet again at `Lookup geo, catalogue, history`.
5. **If it fails:** —
6. **Protection:** an empty `output` means the gate downstream sees no facts at all and classifies
   the letter by the `nothing_readable` rule.

### 9. `AI extract` (with `OpenRouter Model` and `Extract Parser`)

1. **Type:** `@n8n/n8n-nodes-langchain.agent` v3.1, `onError=continueErrorOutput`, `retryOnFail`.
   The model is `lmChatOpenRouter` v1. The parser is `outputParserStructured` v1.3 with the schema
   in `src/00-intake-router/extract-parser.schema.json`. The system message is
   `src/00-intake-router/ai-extract.prompt.md`.
2. **Input:** `{{ $('Prepare fields').item.json.subject }}` and `body_clean`. **The letter's text and
   nothing else** — no history from the database.
3. **Does:** extracts the facts the letter states — material, area, unit, town, postcode, pattern,
   fixing method, what happens to the old floor, floor level, lift, whether it is commercial, the
   intent — **each with a quotation from the letter as its evidence**.
4. **Passes on:** `output`, the model's object.
5. **If it fails:** the model is unreachable, a limit is hit, or the answer does not fit the schema —
   the red output goes to 90 Errors. The letter stays at `status='new'`.
6. **Protection:** `retryOnFail` and the red output. The real protection is that **the model is not
   believed**: everything it says is checked by the gate for the quotation actually being in the
   letter (`grounded()`, node 11).

### 10. `Lookup geo, catalogue, history`

1. **Type:** `postgres` v2.6, `onError=continueErrorOutput`, `retryOnFail`.
   `db/00-intake-router/lookup-geo-catalogue-history.sql`, 13 parameters.
2. **Input:** the model's `$json.output`, serialised with `JSON.stringify` and control characters
   stripped; plus fields from `Prepare fields` (`gmail_message_id`, `body_empty`, `has_photo`,
   subject and body as `source_text`, the automation headers, `thread_id`, `contact_email`,
   `is_outbound`, `body_fully_quoted`, `needs_sender_extraction`).
3. **Does:** one `SELECT` that hands its arguments back **together with** what the database knows:
   - `zone_by_zip` — from `service_area` by the first part of the postcode
     (`split_part(zip,'-',1)`);
   - `zone_by_city` — by the town's name, with `", TX"` / `" TEXAS"` trimmed off by a regex;
   - `categories` — the active categories in `price_bands`;
   - `services` — every row, ordered by `priority, id`;
   - `prior_in_thread`, `prior_from_contact`, `prior_offers` — counts of history;
   - `offers_in_thread` — **a different question from `prior_offers`**, and the comment says why:
     a customer who was quoted for a bathroom last year is not agreeing to it by writing today
     about a bedroom;
   - `prior_signatures` — material and area over thirty days, and **only from the verified columns**
     (`material_category`, `area_sqft`), so that a hallucination cannot silence a future quote;
   - `open_job` — the thread's open job (`state NOT IN ('booked','done','lost')`). The comment
     records what it is for: everything above counts **letters**, and every rule that asked "does
     this letter have a material and a size" was really asking "has this customer repeated
     themselves".
4. **Passes on:** about eighteen fields — the whole of the gate's input.
5. **If it fails:** the red output to 90 Errors; `messages` stays at `status='new'`.
6. **Protection:** `retryOnFail` and the red output.

### 11. `Decision gate`

1. **Type:** `n8n-nodes-base.code` v2 — `src/00-intake-router/decision-gate.js`. This is the heart
   of the system: every decision here is deterministic, and the model makes none of them.
2. **Input:** the row from `Lookup geo, catalogue, history`.
3. **Does**, in steps:

   **(a) Grounding.** `grounded(field)` takes the quotation in `evidence[field]`, normalises it
   (quotes, dashes, spacing, lower case) and looks for it in the letter's text with `\b` boundaries.
   `take()` passes on only what is grounded; the rest goes into `dropped_fields`. **This is the only
   reason the model's output can be used at all.**

   **(b) Material.** `MATERIAL_MAP` — five expressions → LVP / Laminate / Wood / Vinyl / Carpet.
   Then `asProduct` checks that against the active catalogue and the `services` table:
   `known` / `offered_not_priced` / `out_of_scope` / `not_in_catalogue` / `unknown`. An unusable
   expression in a `services` row does not bring the node down — it is skipped and the reason is
   written.

   **(c) Area.** `asQuantity` is the longest check:
   - if the quotation carries a figure with a unit and the value handed over is a different one —
     `contradicted`, and nothing is accepted; **except** where metres have already been converted
     to feet to within ±2, which is `converted`;
   - two or more sets of "X by Y" — `unknown`, ask for the total;
   - one set — multiply, and take the unit from the words; if neither side says feet or metres,
     `no_unit`;
   - "3 rooms", "2 units" — `not_an_area`;
   - the unit is accepted when the unit claimed and the unit in the quotation agree;
   - and where they do not agree, or the quotation stops short — **the unit is taken from the letter
     itself**: the twelve characters immediately after the quoted figure, and only those. The model
     quotes the figure and sometimes stops before the word that gives it meaning: "About 400 sq ft."
     came back as `"About 400"`, a figure with no unit was rightly refused, and the desk asked for
     the size, was given it, and asked again. A unit from another sentence does not count: a wrong
     unit is worse than none, because it prices confidently.

   **(d) Place.** The zone by postcode wins over the zone by town; both only where the field they
   come from is grounded.

   **(e) What the job already knows.** `jobKnowsMaterial/Area/Zone` and `jobReady`, from `open_job`.

   **(f) Classification** — an `if/else if` ladder, and the order matters:
   `owner_sent` → `automated_headers` → `fraud_unknown_sender` → `nothing_readable` →
   `complaint_signal` → `offer_response` → `money_known_contact` → `scheduling_signal` →
   `the_job_is_ready` → `same_job_signature` → `thread_continuation` → `not_a_customer` →
   `capability_question` → `wants_a_price` → `unclassified`.
   Two of the rules carry their own history of being wrong:
   `offer_response` requires `offers_in_thread > 0` — without it, "go ahead" from a long-standing
   customer read as agreement to an offer nobody had made;
   `the_job_is_ready` sits **before** everything that files a letter as carrying on a conversation —
   a job with a material, a size and a town is not a conversation, it is a price waiting to happen.

   **(g) Colour and blocking.** For `quote_request`, `missing` is worked out **against the job, not
   against the letter**. Red — out of area, missing fields, the floor in question, an absurd area.
   Yellow — the edge of the service area, an unknown boundary of the work, any reason at all.
   Green — only where there are no reasons.
   `auto_blocked` is raised separately: an unknown boundary of the work, a service not on the list,
   an area that needs confirming, a letter that is entirely quoted history, a platform lead with no
   address, fields the model invented, signs of fraud, commercial premises.
   **Colour and blocking are different things**, and the comment says why: an enquiry that has
   simply not given the area yet is red and **not** blocked, because asking for the area is the
   right automatic answer to it.

   **(h) `pricing_allowed`** = `quote_request` && green && not blocked.

   **(i) Whether an area is plausible is decided outside the branch.** The comment records that the
   same 200,000 sq ft used to be red in a new thread and yellow in a reply within the same one.

   **(j) `settled`** — the one object the gate stands behind. The merge reads **only this**, and the
   comment explains: the merge used to be guarded by colour instead, and that was wrong **in both
   directions on the same day** — an ordinary "laminate, size to follow" contributed nothing,
   because incomplete is also red, while an absurd area mid-conversation was only yellow and went
   straight in.

   **For `owner_reply`, `settled` is empty.** The desk's own letters come back through this same
   lane — otherwise a thread would not know it had been answered — and they were read for facts like
   any customer's. The firm's signature, "Austin, TX — and about thirty miles around it", settled as
   the customer's town: a live job for somebody in Round Rock was corrected to Austin, and the change
   was written down as though the customer had said it. The sentence in the price description,
   "taking the old covering away", became a decision to remove the old floor, which would have been
   charged for. The gate **knew** the letter was ours — it calls them `owner_reply` and writes
   "recorded rather than received" — and settled their facts anyway.
4. **Passes on:** about thirty-five fields: `category`, `route`, `handling`, `gate_color`,
   `gate_reasons`, `matched_rule`, `missing_fields`, `dropped_fields`, `assumptions`,
   `pricing_allowed`, `auto_blocked`, `offer_answer`, `settled`, `segment`, `danger`, `intent`
   and the rest.
5. **If it fails:** there is **no** `try/catch` here. An exception brings the lane down, and
   `errorWorkflow` → 90 Errors catches it. The letter stays at `status='new'`.
6. **Protection:** inside, it is local — an unusable service expression is skipped. There is no
   general guard against an exception; `errorWorkflow` plays that part.
   The logic is covered by `tests/decision-gate.test.js` and `tests/signal-dictionaries.test.js`.

### 12. `What the second reader is asked`

1. **Type:** `postgres` v2.6. `db/00-intake-router/what-the-second-reader-is-asked.sql`,
   2 parameters (`gmail_message_id`, `thread_id`). **`onError` is not set — there is no red output.**
2. **Input:** the ids of the letter and the thread, from `Decision gate` / `Prepare fields`.
3. **Does:** assembles the conversation for a reader who has not seen it:
   - `letters` — **the whole thread**, not the last letter (the comment: reading one letter is a
     mistake made three times in two days);
   - the bodies come from `m.body`, which is already free of quoted history — otherwise the reader
     would be handed the desk's own words and invited to judge them;
   - **a cut by time**: `m.created_at <= (the time of the letter being judged)`, with
     `coalesce(..., 'infinity')`. The comment says this matters when an old decision is re-read:
     without it the reader blames the gate for not knowing the future — which is exactly what it
     was doing;
   - `job` — the thread's job; `history` — `order_events` with the same cut;
   - in `the_job`, the word "state" is deliberately replaced by "how far along": the reader took
     "state" for an American state and complained that Texas had been recorded as "new".
4. **Passes on:** `conversation`, `the_job`, `what_happened` — three finished texts.
5. **If it fails:** **the lane goes down entirely.** There is no red output, so neither `Save triage`
   nor the creation of a job happens. The letter stays at `status='new'` — the gate did its work and
   threw it away.
6. **Protection:** inside, `coalesce` on all three fields, so that an empty result reads as
   "(no letters on file)" rather than as silence. **Against the node itself failing there is none** —
   only `errorWorkflow` records the failure. That the letter is stuck would have been noticed by
   80 Watchman, and that is switched off.

### 13. `Second reader` (with `Second reader parser`)

1. **Type:** `@n8n/n8n-nodes-langchain.agent` v3.1, `onError=continueRegularOutput`,
   `alwaysOutputData`. The schema is `src/00-intake-router/second-reader-parser.schema.json`, the
   prompt `src/00-intake-router/second-reader.prompt.md`.
2. **Input:** the three texts from the node above.
3. **Does:** says whether the code's decision holds (`holds`) and, if not, why (`why`).
4. **Passes on:** `{ holds, why }`, in some shape.
5. **If it fails:** the error goes out of the **ordinary** output, and `alwaysOutputData` guarantees
   an item. The second reader physically cannot stop the lane.
6. **Protection:** that configuration is the protection — the code's decision does not depend on the
   model.

### 14. `Fold in the second opinion`

1. **Type:** `code` v2 — `src/00-intake-router/fold-in-the-second-opinion.js`.
2. **Input:** the reader's answer and `$('Decision gate').all()`.
3. **Does:** `THE_READER_MAY_ACT = false` — the opinion **is written down and changes nothing**. The
   comment records the measurement: on real letters the reader raised its hand on more than a
   quarter of them, and going through those showed a mixture of genuine defects, inventions and
   artefacts. `readVerdict` accepts two words and nothing else; anything else is silence.
   `does_not_hold` with no reason is also silence, because a database constraint refuses a raised
   hand with no explanation. The direction is one-way: `auto_blocked` can only be raised, never
   lowered.
4. **Passes on:** the whole of the gate's decision plus `second_opinion`, `second_opinion_why`,
   `auto_blocked`.
5. **If it fails:** `decisions[i] || decisions[0] || {}` guards against the indexes drifting apart.
6. **Protection:** the asymmetry of direction — the model cannot turn a refusal into permission.
   Plus the constraint `messages_second_opinion_says_why` in `db/schema.sql`.

### 15. `Save triage`

1. **Type:** `postgres` v2.6, `onError=continueErrorOutput`, `retryOnFail`.
   `db/00-intake-router/save-triage.sql`, **32 parameters**.
2. **Input:** everything from `Fold in the second opinion`.
3. **Does:** `UPDATE messages SET …` across thirty columns, `status = CASE WHEN handling='none'
   THEN 'closed' ELSE 'triaged' END`, and stamps `prompt_version='extract-v3'`,
   `extraction_schema_version='v3'`, `workflow_version='v1.4-hardened'`. Returns `saved` — whether
   any row was updated at all.
4. **Passes on:** `gmail_message_id`, `category`, `route`, `handling`, `gate_color`, `saved`.
5. **If it fails:** a violated constraint — there are twenty-odd on `messages` — or an unreachable
   database sends it out of the red output to `Say the write was refused`.
6. **Protection:** the schema's constraints are the protection, in particular
   `messages_pricing_is_green_quote`, `messages_pricing_never_dangerous`,
   `messages_pricing_needs_known_area` and `messages_pricing_needs_nobody_looking`: the database
   physically will not accept permission to price where that permission does not belong.
   **The thirty-two parameters are checked against `$1..$32` by `scripts/extract-code-nodes.js`** —
   its `miscounted` section counts the `$N` in the statement against the length of the array in the
   `.params.json`.

### 16. `Was the decision stored?` / 17. `Say the write was refused`

1. **Type:** `if` v2.2 / `postgres` v2.6 (`onError=continueErrorOutput`, `retryOnFail`,
   `alwaysOutputData`), `db/00-intake-router/say-the-write-was-refused.sql`.
2. **Input:** `saved` / `gmail_message_id` and the error text.
3. **Does:** turns a refused write into a safe state for the letter: `category='unknown'`,
   `route='review'`, `handling='manual_review'`, `gate_color='red'`, `pricing_allowed=false`, and
   puts the reason into `gate_reasons`.
4. **Passes on:** both paths lead to `→ 50 Review` **and** `→ 90 Errors (storage)`.
5. **If it fails:** if even this cannot be written, its red output also goes to 90 Errors.
6. **Protection:** "we could not save it" is never read as "there is nothing to worry about" — the
   letter is explicitly turned red and sent to a person.

### 18. `Find or create an order`

1. **Type:** `postgres` v2.6, `onError=continueErrorOutput`, `retryOnFail`.
   `db/00-intake-router/find-or-create-an-order.sql`, 4 parameters. The fourth is whether the
   category is one of those that open a job (`quote_request`, `existing_project`, `scheduling`,
   `offer_response`, `billing`).
2. **Input:** `gmail_message_id`, `thread_id`, `contact_email`, and that flag.
3. **Does:**
   - `open_in_thread` — whether the thread already has an open job;
   - `already_said` — **what the thread said before the job existed**. The comment: a question about
     what the firm does opens no job, so the material recognised in it has nowhere to go, and
     without this the customer is asked again for what they already wrote. Read **from `settled`**,
     never from the reported columns, newest value winning;
   - `on_site_items` is gathered as a **set across the whole thread**, not from the newest letter:
     stairs are mentioned once and stay mentioned;
   - `made` — the insert, generating a `booking_code`: five letters from an alphabet without I, O
     or L, and two digits without 0 or 1, with no separator. The comment: somebody copies this off
     a screen into a form, and a hyphen is the first thing to be lost;
   - `born` — the `created` event.
4. **Passes on:** `order_id`, `order_was_created`, `order_was_found`.
5. **If it fails:** the red output → 90 Errors (routing). Two identical jobs on one thread are
   impossible.
6. **Protection:** the partial unique index
   `orders_one_open_per_thread ON orders (thread_id) WHERE state NOT IN ('booked','done','lost')`
   in `db/schema.sql`. The code's shape is held by `orders_booking_code_shape`, its uniqueness by
   `orders_booking_code_unique`.
   **Nobody handles a collision of codes:** generation is random, and on a clash the insert simply
   falls out of the red output. The space is 23⁵ × 8² ≈ 412 million, so at these volumes it is
   theory.

### 19. `Merge the facts`

1. **Type:** `postgres` v2.6, `onError=continueErrorOutput`, `retryOnFail`.
   `db/00-intake-router/merge-the-facts.sql`, 7 parameters.
2. **Input:** `gmail_message_id`, `order_id`, **`settled`** (not the separate fields), the category,
   route, handling and colour.
3. **Does:**
   - `trusted` — one row: `$3::jsonb`. Everything below reads the facts **through it**, so that the
     part which updates the job and the part which writes the log cannot disagree about what was
     believed;
   - `before` — `SELECT … FOR UPDATE`. The comment says the lock is not for the update's sake: two
     letters merging into one job would otherwise read the same snapshot, and the second would write
     "it was empty" for a field the first had already filled;
   - `changes` — the difference between old and new;
   - `applied` — an `UPDATE` through `coalesce`, so a new value only where there is one;
     `on_site_items` is merged as a **set** rather than assigned;
   - `AND (SELECT row FROM before) IS NOT NULL` in the `WHERE`, so that `before` runs **first**;
     without it the snapshot could re-read the row this same statement has already written, and a
     correction would never reach the log as a correction;
   - `logged` — the `merged` / `corrected` events;
   - `ready` — **whether this letter completed the job**. A question only this statement can answer:
     the gate decided the route before the merge, which means it decided about the job as it stood a
     minute earlier. A customer who was asked for the size and answers with the size sends a letter
     naming no material and no town — the gate quite correctly calls it carrying on a conversation
     and sends it to a lane with nothing to do for a job in that state. The desk asked, was
     answered, and said nothing. The price arrived on whatever the customer happened to send next.
     The conditions: `a_job_is_fully_described(applied)` — the row just written, not the table,
     because everything inside one statement sees one snapshot; `NOT
     a_job_is_held_for_a_person(id, $1)` — this letter is named separately, because its `order_id`
     is set further down in this same statement; a category the gate would itself have called ready;
     and no offer on the job;
   - `linked` — files the letter against the job **and in the same `UPDATE`** rewrites `route` to
     `quote` and `matched_rule`, where `ready` says so. A separate statement does not work: Postgres
     carries out one modification per row per statement and silently drops the second, so the record
     would disagree with where the letter actually went.
4. **Passes on:** `order_id`, `order_state`, the merged facts, `facts_written`, `facts_corrected`,
   `still_missing`, `handling` and `gate_color` straight through — and **the route off the written
   row itself** (`RETURNING route`), not off `ready`. Reading `ready` from the outer `SELECT` makes
   the planner run the order update before the locking read in `before`, and a corrected fact then
   begins to look like a value the job always held. `db:round-trip` caught that, not I.
5. **If it fails:** the red output → 90 Errors (routing). The letter keeps `status='triaged'` but
   has no `order_id`.
6. **Protection:** `FOR UPDATE`, a forced order of the CTEs (`ready` reads `logged`, `applied` reads
   `before`), and reading **only** from `settled`. The constraint `orders_area_sane` — `area_sqft`
   between 20 and 20,000, in `db/schema.sql` — is the last line if the gate is wrong.

### 20. `Route by type`

1. **Type:** `n8n-nodes-base.switch` v3.2, seven rules plus `fallbackOutput: "extra"`.
2. **Input:** `route` from `Merge the facts`.
3. **Does:** string equality, one output per lane.
4. **Passes on:** 0→10 Quote, 1→20 Project, 2→30 Support, 3→40 Operations, 4→50 Review,
   5→60 Approval, 6→99 Log only, **7 (fallback)→90 Errors (routing)**.
5. **If it fails:** an unknown route is not lost — it falls through to the fallback.
6. **Protection:** the fallback, and the constraint `messages_route_known`.

### 21. The calls into other lanes

`→ 10 Quote`, `→ 20 Project`, `→ 30 Support`, `→ 40 Operations`, `→ 50 Review`,
`→ 60 Approval`, `→ 90 Errors (×4)` — all `n8n-nodes-base.executeWorkflow` v1.2 in `passthrough`
mode: the lane receives **every** field the router produced. They have no error handling and return
nothing; their output leads nowhere.

---

# Lane 10 — Quote

File: `workflows/10-quote.json`, 28 nodes. `errorWorkflow="90 Errors"`.

## What wakes it

`Called by router` — an `executeWorkflowTrigger` v1.1 with `inputSource=passthrough`. No schedule.
Lane 00 calls it when `route='quote'` — that is, when the category is `quote_request` or `pre_sales`.

## The chain

```
Called by router
  └─► Accept handoff
        └─► Gather what a price needs
              └─► Compute quote
                    └─► Is there a price?
                          ├──yes──► Write the offer
                          │            └─► What the quote letter needs
                          │                  └─► Is the quote ready?
                          │                        ├──yes──► Compose the quote
                          │                        │            └─► Draft the quote  (a Gmail draft)
                          │                        │                  └─► Say the offer was put forward
                          │                        │                        └─► Say a quote is waiting
                          │                        │                              └─► Tell the owner  (#drafts) ▪
                          │                        └──no───► ✖ NOWHERE
                          └──no───► Should we ask, and for what
                                       └─► Is there anything to say?
                                             ├──yes──► Compose the reply
                                             │            └─► May it go out alone?
                                             │                  ├──yes──► Answer the customer ─► Say we asked ▪
                                             │                  └──no───► Show it to the owner instead ▪
                                             └──no───► What a question deserves
                                                          └─► Is it worth answering?
                                                                ├──yes──► Answer the question ─► Reply to the question ─► Say we answered ▪
                                                                └──no───► Say a job needs a person ─► Tell the owner  (#needs-a-person) ▪
```

## What it depends on in the database, and what it changes

**Reads:** `orders` (everything the price is worked out from), `messages` (address, thread,
blocking), `price_bands` (the active ones), `pricing_rules`, `reply_templates`, `services`,
`order_events` (whether the customer has already been asked).

**Writes:** `messages.status/handled_by/handoff_at/offer_id`, `offers` (a new draft row, then
`awaiting_approval` with `letter_text` and `approval_thread_id`), `orders.state='quoted'`,
`order_events` (`state_change`, `asked`). Plus a **Gmail draft** in the customer's own conversation
and a line in Slack — both outside the database.

## The nodes of lane 10

### 1. `Accept handoff`

1. `postgres` v2.6, `db/10-quote/accept-handoff.sql`, 3 parameters.
2. **Input:** `gmail_message_id`, and the literals `'awaiting_pricing'` and `'10 Quote — Flooring'`.
3. **Does:** `UPDATE messages SET status, handled_by, handoff_at = now()`.
4. **Passes on:** `gmail_message_id`, `category`, `handling`, `status`, `handled_by`.
5. **If it fails:** there is no red output — the lane falls over, and `errorWorkflow` catches it.
6. **Protection:** the constraint `messages_handoff_is_stamped` does not allow `handled_by` without
   `handoff_at`. **A second call simply overwrites the stamp** — there is no protection against a
   double handoff here, and no harm from one either.

### 2. `Gather what a price needs`

1. `postgres` v2.6, `retryOnFail`. `db/10-quote/gather-what-a-price-needs.sql`, 1 parameter.
2. **Input:** `gmail_message_id`.
3. **Does:** gathers **everything the arithmetic needs into one row**. The important thing is in the
   comment: permission to price is a question **about the job, not about the latest letter**. It
   used to be read off the letter, which made the conversation this system exists for impossible:
   a customer writes "laminate, Kyle TX", then "about 400 sq ft" — and the second letter names no
   town, so the gate turns it red and asks for one, while the job has had it since the first letter.
   - `fully_described` — the function `a_job_is_fully_described(orders)`: material, area, zone,
     zone ≠ `out`, and the job not closed;
   - `free_to_price` — `NOT a_job_is_held_for_a_person(order_id, NULL)`: no letter on the job is
     `danger`, `auto_blocked` or `commercial` (one held letter holds the whole job: a commercial
     property does not stop being one because the next letter is ordinary). The second argument is
     a letter not yet filed against the job; here it is `NULL`, because by the time a job reaches
     this lane everything is filed;
   - `commercial` — separately, and only to label `segment`;
   - `bands` — **only the `active` ones** (the comment: a band switched off in the table is a
     product the firm no longer offers);
   - `on_site_rates` — the per-step rate from `price_bands`, the levelling rate from
     `pricing_rules.subfloor_leveling`.
4. **Passes on:** `pricing_allowed`, `gate_color`, `segment`, `order_id`, the job's facts, `bands`,
   `rules`, `on_site_items`, `on_site_rates`.
5. **If it fails:** `retryOnFail`, then the lane falls over.
6. **Protection:** `coalesce(..., false)` on `pricing_allowed` — a missing job reads as "not
   allowed" rather than as `null`.

   **Both questions are database functions rather than expressions written here** (migration 43).
   Lane 00 calls the same two when deciding whether to send a letter for pricing. Until 5 August
   they were two copies of one rule, and the copies drifted apart: the copy in lane 00 said a held
   job was ready and sent it here — and here it was refused, there was nothing missing to ask about,
   and the customer heard nothing at all.

### 3. `Compute quote`

1. `code` v2, `mode=runOnceForAllItems` — `src/10-quote/compute-quote.js`.
2. **Input:** the row from the node above.
3. **Does:**
   - `REFUSALS` — eight named reasons to refuse, each with its own code:
     `pricing_not_allowed`, `not_green`, `commercial`, `no_material`, `no_price_band`, `no_area`,
     `area_not_usable`, `no_removal_rate`;
   - `money()` rounds through a decimal exponent rather than `Math.round(n*100)` — the comment
     records that `10.075*100` is `1007.4999…` and the cent goes down;
   - `asBand` discards a band with the wrong unit, a non-positive rate, an inverted range or a
     nonsensical wastage percentage — **silently**, so that an empty list becomes `no_price_band`;
   - the area is multiplied by `1 + wastage/100` **before** rounding (the comment: square feet
     rounded to the cent are not a unit of anything);
   - the minimum charge is applied **before** travel, not after: a minimum is what makes it worth
     turning up, and travel is not floor work;
   - `travel_fee` for the `edge` zone (the comment: until then `edge` produced the phrase "a travel
     fee applies" and never became money);
   - the `on_site` lines carry **deliberately no quantity and no total**: counting stairs from a
     letter means guessing a number the owner will then have to honour.
4. **Passes on:** `priceable`, `refusals`, `subtotal_low/high`, `total_low/high`, `breakdown` (with
   `basis`, the lines and the rates), `pricing_version='quote-v1'`.
5. **If it fails:** it throws nothing; anything missing becomes `priceable:false` with a named
   reason.
6. **Protection:** the `REFUSALS` list is the protection, and it is walked through in full, so
   `refusals` shows **every** reason rather than the first. Covered by `tests/compute-quote.test.js`.

### 4. `Is there a price?`

1. `if` v2.2 on `priceable`.
2–4. Yes → `Write the offer`; no → `Should we ask, and for what`.
5–6. The "no" branch leads to a conversation with the customer rather than nowhere — which is the
protection against silence.

### 5. `Write the offer`

1. `postgres` v2.6, `retryOnFail`. `db/10-quote/write-the-offer.sql`, 8 parameters.
2. **Input:** `gmail_message_id`, `order_id`, four totals, `breakdown`, `pricing_version`.
3. **Does:** in one statement — `before` (with `FOR UPDATE`), `made` (the insert into `offers` with
   `status='draft'`, only where the job is not closed), `moved` (`orders.state='quoted'`, only where
   the state was **not** already `quoted`), `noted` (a `state_change` carrying the **old** value),
   `linked` (`messages.offer_id`).
   The comment: "quoted" is half the story — a first offer and a re-price after the customer changed
   the room are different things, and the difference is what it was before.
4. **Passes on:** `offer_id`, `order_id`, `state_before`, `order_moved`, `change_recorded`,
   `message_linked`.
5. **If it fails:** `retryOnFail`, then the lane falls over. **A second run will create a second
   offer** — there is no protection against that here; what will not happen is a second state change
   and a second event (the `IS DISTINCT FROM 'quoted'` guard).
6. **Protection:** one statement — an offer cannot exist without the job moving, and a job cannot
   read as "quoted" without an offer behind it. Constraints `offers_total_ordered` and
   `offers_total_sane`.

### 6. `What the quote letter needs` / 7. `Is the quote ready?`

1. `postgres` v2.6 (`db/10-quote/what-the-quote-letter-needs.sql`, 2 parameters) / `if` v2.2.
2. **Input:** `gmail_message_id`, `offer_id`.
3. **Does:** builds the letter from the **recorded** offer rather than by pricing again — the
   comment: a price given today has to stay explicable after the price list changes, and that is
   only true while the letter says what the offer says. `ready_to_write` requires an offer to exist,
   `total_low` not to be `null`, `status='draft'`, and `quote_opening` and `quote_closing` to be
   stored.
4. **Passes on:** the totals, `breakdown`, the job's facts, the address, the thread, the subject,
   the three pieces of wording, `ready_to_write` — and **the way to say yes**: `booking_link` and
   `quote_booking` from `reply_templates`, and `booking_code` from the order.
5. **If it fails:** the lane falls over.
6. **Protection:** `ready_to_write` does not allow a letter to be composed without the stored
   wording.
   ✖ **The "no" branch of `Is the quote ready?` is wired nowhere.** A finished offer that could not
   be put into words — a missing row in `reply_templates` — disappears quietly: `offers` stays
   `draft`, nobody writes to the owner, and no failure is recorded.

### 8. `Compose the quote`

1. `code` v2 — `src/10-quote/compose-the-quote.js`.
2. **Input:** the row from the node above.
3. **Does:** builds **one** text — the letter as the customer will read it. There is no wrapper for
   the owner any more: the letter sits in the owner's own mail client, one step from being sent, and
   anything above it would be one deleted paragraph away from reaching the customer.
   - the subject gets `Re:` exactly once, and an empty one stays empty: Gmail attaches a draft to a
     thread by its subject, so inventing one puts the draft beside the conversation instead of
     inside it;
   - at the bottom, under the price and before the signature, is the **booking block**: a line from
     `reply_templates`, the link to the page, and the order's code. With no code or no link there is
     no block at all, because a line without a code asks the customer for something they were not
     given.
4. **Passes on:** `write_to` (the customer), `thread_id`, `subject`, `body`, `the_letter_itself`.
5. **If it fails:** `ready_to_write !== true` throws; an empty address throws. A lead from a
   platform with no reply-to has nobody to write to, and a draft with an empty To field is the kind
   somebody sends by accident.
6. **Protection:** a check in the repository refuses to let this file read what the owner is told.
   The line about the draft is composed in a node of its own for exactly that reason.

### 9. `Draft the quote` (Gmail · draft) / 10. `Say the offer was put forward`

**Input.** What `Compose the quote` built: the customer's address, `thread_id`, the subject with
`Re:`, and the body.

**Does.** Creates a **Gmail draft in the customer's own conversation**. It does not send. It returns
the draft's id and the `threadId`.

**Passes on.** `Say the offer was put forward` follows: the offer moves `draft → awaiting_approval`,
and `letter_text` — what was composed — and `approval_thread_id` are written onto it.

**If it fails.** No draft means nothing to send. The offer stays `draft`, which means lane 75 will
not chase it: that lane looks only for `awaiting_approval`.

**Protection.** A draft has no way of leaving on its own. That is a stronger guarantee than the one
it replaced: the previous shape mailed the letter to **the owner** and read the reply with patterns,
so a figure reached a customer whenever a pattern matched, and "almost right, let me change a word"
was read as a refusal — because `change` was one of the words that meant no.

### 11. `Say a quote is waiting` / 12. `Tell the owner` (Slack)

**Input.** What `Say the offer was put forward` returned, plus reaching back to
`What the quote letter needs` and `Compose the quote` through `itemMatching`.

**Does.** Composes the line for the owner: the price range, the customer's address, the job, and a
**link into the conversation itself** — `?authuser=<mailbox>#all/<thread_id>`, labelled with the
subject of the letter. Sets `channel: '#drafts'`.

**Passes on.** `Tell the owner` posts to the channel the line itself carried (`{{ $json.channel }}`).

**If it fails.** The draft is already there, but nobody knows about it — until lane 75 says so six
hours later.

**Protection.** A file of its own rather than a few lines inside the letter's composer: a check in
the repository refuses to let a customer's letter be composed in a file that reads what the owner is
told. This carries figures and the `auto_blocked` flag — things the customer must never see.

**Why the mailbox is chosen by address.** `u/<number>` is an account index in one particular
browser, different on every machine; written into the path it answers 404. `?authuser=<address>` is
resolved by Gmail itself.

### 13. `Say a job needs a person`

**Input.** The second output of `Is it worth answering?` — a branch that until 5 August **had no
wire on it at all**.

**Does.** Only where the job is described in full: composes a line saying the job is described and
only a person can price it, with the reason — commercial, a managing agent, or a letter with a
danger signal on it. Sets `channel: '#needs-a-person'`.

**Passes on.** `Tell the owner`.

**If it fails.** Silence — which is what happened before 5 August.

**Protection.** An incomplete job does not reach here: it has already been asked about, and asking
twice with nothing in between is exactly what the asking rule exists to prevent.

### 14. `Should we ask, and for what`

1. `postgres` v2.6, `db/10-quote/should-we-ask-and-for-what.sql`, 2 parameters.
2. **Input:** `gmail_message_id`, `order_id`.
3. **Does:** decides **both whether to speak and in what words**, in one statement:
   - `still_missing` — from the **job**, not from the letter;
   - `last_ask` — the latest event with `kind='asked' AND field='still_missing'`. Naming the field
     is deliberate: a nudge is also an `asked` event, and without this a nudge would read as the
     question having changed;
   - `arrived_since` — how many `merged` / `corrected` events since the last asking;
   - `should_ask` = something is missing **and** (the list has changed **or** something new has
     arrived). The same question twice with nothing in between is no;
   - `should_speak` = `should_ask` **or** the zone is `out`. The comment: a property outside the
     area has nothing missing — the job knows its zone, it is simply not ours — so nothing was asked
     and nothing was said, and the customer heard silence;
   - `may_go_alone` = the template's `sends_automatically` **and** the letter not being
     `auto_blocked`. Two permissions, both required;
   - `letter` takes the address and the thread **here** — the comment records that the composer
     used to reach for them from a node that returns neither, so a live run had nobody to write to
     while a test that handed the fields in passed;
   - `rates` — the published rates per sq ft, narrowed to the material where the job names one;
   - the template is chosen **here too**, `LEFT JOIN reply_templates` on a `CASE` over
     `still_missing`.
4. **Passes on:** `should_speak`, `should_ask`, `asking_for`, `may_go_alone`, `body`, `signature`,
   `out_of_area` and the words of the refusal, `bands`, `rates_preamble`, `area_sqft`,
   `worth_illustrating`, `contact_email`, `thread_id`.
5. **If it fails:** the lane falls over.
6. **Protection:** "ask once" rests on the **job's history** rather than on a flag — so it survives
   redeliveries and restarts.

### 15. `Is there anything to say?` / 16. `Compose the reply` / 17. `May it go out alone?`

1. `if` v2.2 on `should_speak` / `code` v2 (`src/10-quote/compose-the-reply.js`) / `if` v2.2 on
   `reaches_the_customer`.
2. **Input:** the decision row.
3. **Does:** a refusal beats everything — both the figure and the question (the comment: somebody
   who wrote "Dallas" has already said where they are). Empty template text is an exception, not an
   empty letter. A missing address is an exception: a platform lead with no `reply-to` has nobody to
   answer, and going to the error lane is better than reaching the platform instead of the customer.
   Where the letter goes is **the stored sentence's decision**, not this file's.
4. **Passes on:** `to`, `reaches_the_customer`, `subject`, `body`, `asking_for`, `order_id`.
5. **If it fails:** the two named exceptions → `errorWorkflow`.
6. **Protection:** `$input.all().map(...)` — the comment says the first version answered the first
   customer and **silently** lost the second whenever a poll brought two.

### 18. `Answer the customer` / 19. `Say we asked` / 20. `Show it to the owner instead`

1. `gmail` v2.1 (`reply` to `$json.gmail_message_id`) / `postgres` v2.6
   (`db/10-quote/say-we-asked.sql`, 3 parameters) / `gmail` v2.1 (`send`).
2–4. The reply to the customer, then an `asked` event listing what was asked for.
5. **If it fails:** if the send fails, `Say we asked` does not run, and the next letter asks again —
   the comment says that is the right side to fail on: a question the customer never received must
   not count as asked.
6. **Protection:** the order — letter first, record second.
   ✖ **`Show it to the owner instead` has no next node at all.** When the letter goes to the owner
   there **is** no `asked` event, so `last_ask` stays empty, `should_ask` is `true` for ever, and
   **on every subsequent letter about that job the owner receives the same unsent letter again**.

### 21–24. `What a question deserves` → `Say we answered`

1. `postgres` v2.6 (`db/10-quote/what-a-question-deserves.sql`) → `if` → `code`
   (`src/10-quote/answer-the-question.js`) → `gmail` (`reply`) → `postgres`
   (`db/10-quote/say-we-answered.sql`).
2. **Input:** `gmail_message_id`.
3. **Does:** answers a question about what the firm does, taking the words from the `services` table
   (the comment: changing what the firm says about tile is one edit in one table). `worth_answering`
   requires the question to be recognised, an answer to be stored, an address to exist, and the
   letter **not** to be blocked. The request for details is added **only** where the firm does the
   work in question (the comment: asking for the area of a job you have just refused reads as not
   having listened).

   **The answer carries the rates per square foot** — `rates_preamble` and the bands from
   `price_bands`, narrowed to the material where the job names one. Until 4 August that block was
   never built at all: the `rates_preamble` row simply did not exist in production, and the code
   quietly returned an empty string. A test now watches for that — every key a lane asks for has to
   exist in the seed.

   **And a greeting** — `service_answer_opening`, of the same origin: the first letter from the
   system used to begin with the answer, with no form of address at all.
4. **Passes on:** the letter, `handled_by='10 Quote — Flooring (answered a question)'`,
   `status='closed'`.
5. **If it fails:** the "no" branch of `Is it worth answering?` **now leads** to
   `Say a job needs a person` (node 13). Until 5 August it led nowhere: a letter this lane could
   neither price nor answer stayed `awaiting_pricing` for ever. The branch fires on a held job —
   commercial, a managing agent, a danger signal — because there is no price (correctly), nothing
   missing to ask about (the job is complete), and it is not a question about what the firm does.
   The owner now hears about such a job.
6. **Protection:** `worth_answering` combines four conditions, and a blocked letter is never
   answered automatically.

---

# Lane 20 — Project

File: `workflows/20-project.json`, 9 nodes.

## What wakes it

`Called by router`, `passthrough`. Lane 00 calls it when `route='project'` — that is,
`existing_project`, `scheduling`, `offer_response` or `billing`.

## The chain

```
Called by router
  └─► Accept handoff  ──┬─► Accepting a ballpark asks for a visit ▪
                        └─► What the invitation needs
                              └─► Write the invitation
                                    └─► Is there an invitation to send?
                                          ├──yes──► Ask them to pick a time ─► Say we invited them ▪
                                          └──no───► ✖ NOWHERE
```

**Two branches from one output, and the second depends on the first.** `What the invitation needs`
requires `o.state='survey_needed'`, and that state is set by `Accepting a ballpark asks for a visit`.
The order is held only by where the nodes sit on the canvas (`[740,300]` against `[960,480]`) under
`executionOrder=v1`. There is nothing in the files that records the dependency explicitly.

## What it depends on in the database, and what it changes

**Reads:** `messages.offer_answer` and `order_id`, `offers`, `orders`, `visits`, `reply_templates`.
**Writes:** `offers.status='accepted'` / `outcome='won'`, `orders.state='survey_needed'` (or `booked`
for a firm offer), `visits` — a row at `offered`, `messages.status='awaiting_owner'`.

## The nodes of lane 20

### 1. `Accept handoff`

The same statement as in lane 10, with `'awaiting_owner'` and `'20 Project — Flooring'`. There is no
red output; a failure brings the lane down into `errorWorkflow`.

### 2. `Accepting a ballpark asks for a visit`

1. `postgres` v2.6, `db/20-project/accepting-a-ballpark-asks-for-a-visit.sql`, 1 parameter.
2. **Input:** `gmail_message_id`.
3. **Does:** this is **the boundary** the whole system exists for. The comment: a customer who said
   yes to a price worked out from an email has not ordered the work — they have agreed to a visit,
   because nobody has seen the floor and the figure came from what they typed. An earlier attempt
   moved the job straight to `booked`, which promises a date this desk cannot honour and a price it
   cannot stand behind.
   - `answered` — the letter with `offer_answer='accepted'` and a job;
   - `the_offer` — the newest offer with `status IN ('sent','awaiting_approval','accepted')`;
   - `settled` — `status='accepted'`, `outcome='won'`, **only where `outcome IS NULL`**;
   - `moved` — `quoted`/`negotiating` → `survey_needed`, or `booked` **only** where `kind='firm'`
     (nothing issues a firm offer today), and then `closed_at` as well, because the database refuses
     a closed job with no closing time.
4. **Passes on:** `order_id`, `offer_kind`, `offer_settled`, `order_state`, `moved`. Terminal.
5. **If it fails:** the lane falls over. A second run is harmless — the comment says it is written
   that way on purpose.
6. **Protection:** `AND o.outcome IS NULL` and `AND o.state IN ('quoted','negotiating')` — a job
   somebody has already finished will not be reopened. Plus the constraint
   `orders_closed_is_stamped`.

### 3. `What the invitation needs`

1. `postgres` v2.6, `db/20-project/what-the-invitation-needs.sql`, 1 parameter.
2. **Input:** `gmail_message_id`.
3. **Does:** hands over everything the invitation letter needs — **only** where the job has just
   become `survey_needed`, has an address, has a code, and there is **no** visit at `offered` or
   `agreed`. The address comes **from the job**, not from the letter: inviting one address while
   expecting a booking from another is how matching starts arguing with itself.
4. **Passes on:** `order_id`, `write_to`, `booking_code`, the job's facts, four pieces of wording.
5. **If it fails:** an empty result — n8n passes an empty item on, and the code catches that.
6. **Protection:** `NOT EXISTS (… visits … state IN ('offered','agreed'))` — a second invitation
   goes out neither from a repeated "yes" nor from a redelivery.

### 4. `Write the invitation` / 5. `Is there an invitation to send?`

1. `code` v2 (`src/20-project/write-the-invitation.js`) / `if` on `ready_to_send`.
2. **Input:** the row above.
3. **Does:** the code **starts** by checking for emptiness (the comment: the lookup returns nothing
   when the job has already been invited, n8n passes the empty item on, and saying so is better than
   sending a letter with the word `undefined` where a link should be). The code is printed **on a
   line of its own and nowhere else**: somebody will copy it by eye into a form on another page.
4. **Passes on:** `ready_to_send`, `why_not`, `subject`, `body`.
5. **If it fails:** it throws nothing — everything becomes `ready_to_send:false` with a named reason.
6. **Protection:** ✖ **the "no" branch is wired nowhere.** `why_not` is composed, written into the
   `json` — and read by nothing. The reason an invitation did not go out reaches neither the
   database nor the owner.

### 6. `Ask them to pick a time` / 7. `Say we invited them`

1. `gmail` v2.1 (`send` to `write_to`) / `postgres` v2.6 (`db/20-project/say-we-invited-them.sql`,
   2 parameters).
2. **Input:** the letter / `gmail_message_id`, `order_id`.
3. **Does:** inserts a `visits` row at `state='offered'`, `offered='["the booking page"]'`. The
   comment: there is nothing to store in `offered`, because Google knows the times — the array is
   left over from a different design in which the desk named three itself.
4. **Passes on:** `id`, `order_id`, `state`. Terminal.
5. **If it fails:** the letter went and the record did not → **the next delivery of the same "yes"
   sends a second invitation**, because the `NOT EXISTS` in node 3 no longer sees anything.
6. **Protection:** `WHERE NOT EXISTS (…)` in the statement itself, plus the partial unique index
   `visits_one_open_per_order ON visits (order_id) WHERE state = 'offered'` — the index holds even
   when the `NOT EXISTS` did not get there in time.

---

# Lane 25 — Visits

File: `workflows/25-visits.json`, 43 nodes. **The largest lane, and the only one with several
independent ways in.** It is six separate mechanisms in one file.

## What wakes it

| # | Branch | What wakes it | Interval |
|---|---|---|---|
| A | A booking arrived | `A visit was booked` — `googleCalendarTrigger` v1, `triggerOn=eventCreated`, calendar `primary` | every minute |
| B | Confirmation to the customer | `Time to say something` — `scheduleTrigger` v1.2 | 5 min |
| C | Checking against the calendar | `Check what the calendar says` — `scheduleTrigger` v1.2 | 15 min |
| D | What to tell the owner | `Time to tell the owner` — `scheduleTrigger` v1.2 | 10 min |
| E | Preparing the agreement | `Time to prepare the agreement` — `scheduleTrigger` v1.2 | 10 min |
| F | The answer about the address | `Time to read the answers` — `scheduleTrigger` v1.2 | 2 min |

## The chains

```
A:  A visit was booked ─► Read the booking ─► Whose job is this
                                                 └─► Is anybody sure whose job this is?
                                                       ├──yes─► Remember where the job is ─► Write the booked visit
                                                       │            └─► Say two towns are on one job  (only where they differ)
                                                       │                  └─► Ask about the two towns  (#needs-a-person)
                                                       │                        └─► Remember we asked about the town ▪
                                                       └──no──► Say nobody can place this booking ─► Ask the owner to place it  (#needs-a-person) ▪

B:  Time to say something ─► Which visits need a word ─► Write the confirmation
                                └─► Is there a letter to send?
                                      ├──yes─► Tell the customer ─► Say the visit was confirmed ▪
                                      └──no──► ✖ NOWHERE

C:  Check what the calendar says ─► Visits worth checking ─► What is on the calendar
                                       └─► What the calendar says now ─► Moved, or gone?
                                             ├──moved─► The visit moved ▪
                                             └──else──► The visit is off ▪

D:  Time to tell the owner ─► What the owner has not been told ─► Write what the owner is told
                                └─► Is there something to say?
                                      ├──yes─► Tell the owner (Slack #going-out) ─► Say the owner was told ▪
                                      └──no──► ✖ NOWHERE

E:  Time to prepare the agreement ─► Claim the visits that need an agreement ─► Write the agreement
                                       └─► Is there an agreement to prepare?
                                             ├──yes─► Copy the template ─► Fill the copy ─► Did every placeholder land? ─► Say where the agreement is ▪
                                             └──no──► ✖ NOWHERE

F:  Time to read the answers ─► Which answers are we waiting on ─► Ask Slack what they said
                                  └─► Read the answer  (only ✅ or ❌; anything else keeps waiting)
                                        └─► Write down the answer ▪
```

## What it depends on in the database, and what it changes

**Reads:** `orders` (address, facts, code), `visits` (the state and every time stamp), `offers`
(only a `ballpark` that **actually went out**), `price_bands`, `pricing_rules`, `reply_templates`.
**Writes:** `visits` — a row at `agreed`, then `confirmed_at`, `owner_told_at`, `agreement_url`,
`agreement_started_at`, `state='lapsed'`, a shifted `agreed`, and the `site_check_*` /
`site_agreed` columns; `orders.site_street/site_city/site_postcode`.
**This lane does not move the job (`orders.state`) at all** — except through branch F, where a
cross on a mismatched address closes it. A cancelled visit neither closes a job nor reopens an offer.

## Branch A — a booking arrived

### A1. `A visit was booked`

1. `n8n-nodes-base.googleCalendarTrigger` v1, `triggerOn=eventCreated`, `calendarId=primary`,
   polling every minute.
2. **Input:** the Google Calendar API.
3. **Does:** catches a new event.
4. **Passes on:** the event (`id`, `attendees`, `organizer`, `description`, `start`, `summary`).
5. **If it fails:** Google is unreachable and nothing happens. A booking is not lost for ever,
   because branch C checks the calendar every fifteen minutes — **but** C looks only at visits the
   database **already knows about**: a booking the trigger missed, C will never see.
6. **Protection:** against a missed booking there is none.

### A2. `Read the booking`

1. `code` v2 — `src/25-visits/read-the-booking.js`.
2. **Input:** the calendar event.
3. **Does:**
   - the guest's address comes **from the attendee list, never from the description**: the same
     booking form produced "Zarezerwowane przez" for one booking and "Booked by" for the next,
     because a setting changed in between; any rule keyed on those words breaks the day somebody
     books from another country;
   - the code is read out of the description **by our own label**, "Order code" — which is the same
     in whatever language Google draws the rest of the page in;
   - `answerTo` takes the first non-empty line after the label, **but not when that line is the next
     question**: an empty street became "City", and that reached the job and was printed on the page
     the customer signs;
   - the code is cleaned of spaces, hyphens and full stops (`tidy`), then checked against the shape
     `^[A-Z without I,O,L]{5}[2-9]{2}$`. The comment: somebody who typed "kqmnp 47" has done nothing
     wrong and should not lose their booking.
4. **Passes on:** `event_id`, `booked_email`, `booking_code`, `code_as_typed`, `site_street`,
   `site_city`, `site_postcode`, `starts_at`, `time_zone`, `nothing_to_go_on`.
5. **If it fails:** it throws nothing.
6. **Protection:** the check on the code's shape. ✖ **`nothing_to_go_on` is computed and read
   nowhere** — checked by `grep` across the whole tree: the only occurrences are the file itself and
   its copy inside the workflow JSON.

### A3. `Whose job is this`

1. `postgres` v2.6, `db/25-visits/whose-job-is-this.sql`, 3 parameters.
2. **Input:** `booked_email`, `booking_code`, `code_as_typed`.
3. **Does:** looks for the job by two routes and decides whether it is sure enough. The comment says
   plainly that **the order of the checks carries no weight at all**: where both answer, they answer
   the same, and where they disagree, neither is taken. Safety comes from the refusal, not from the
   order; swapping them breaks no check, which is how that was found out.
   Only open jobs. And what somebody typed matters **even when it matched nothing**: a code leading
   nowhere is a customer telling us something, and that something contradicts the ordinary
   conclusion.
   `needs_a_person` = "they disagree" **or** "a code was typed and matched nothing".
4. **Passes on:** `by_email`, `by_code`, `order_id`, `matched_by`, `needs_a_person`, `write_to`.
5. **If it fails:** the lane falls over.
6. **Protection:** the refusal where they disagree. ✖ **The `'nothing matched'` case is not
   covered:** `needs_a_person` is `false` for it, so the booking goes down the **confident** branch
   with `order_id = NULL`, `Remember where the job is` touches no row and returns nothing — and
   `Write the booked visit` receives no items. **The booking disappears without trace: no visit, no
   Slack line, no failure recorded.** The customer, meanwhile, has a confirmation from Google.

### A4. `Is anybody sure whose job this is?` / A5. `Say nobody can place this booking` / A6. `Ask the owner to place it`

1. `if` v2.2 (condition: `needs_a_person` **is false**) / `code` v2
   (`src/25-visits/say-nobody-can-place-this-booking.js`) / `slack` v2.3 (`post` to
   `={{ $json.channel }}`, `authentication=accessToken`).
2. **Input:** the row above; the code additionally reaches for the booking through
   `$('Read the booking').itemMatching(i)`.
3. **Does:** writes to the owner that the booking cannot be placed anywhere, with both candidates and
   the code as typed. Sets `channel: '#needs-a-person'` — the desk has no right to act on its own
   here. It records nothing and books nothing.
4. **Passes on:** `message` → Slack. Terminal.
5. **If it fails:** Slack unreachable — the lane falls into `errorWorkflow`.
6. **Protection:** `itemMatching(i)`, **never `all()[i]`** — the comment explains: an IF stands
   between this node and the booking, and an IF **compacts**; one usable booking ahead of an
   unusable one leaves the second at index zero, where it was first. Matching by position would put
   **somebody else's address** into this notification.

### A7. `Remember where the job is` / A8. `Write the booked visit`

1. `postgres` v2.6 (`db/25-visits/remember-where-the-job-is.sql`, 4 parameters) / `postgres` v2.6
   (`db/25-visits/write-the-booked-visit.sql`, 3 parameters).
2. **Input:** `order_id` and the three address fields / `order_id`, `starts_at`, `event_id`.
3. **Does:** the address is written through `coalesce` (the comment): a rebooking that left a field
   blank must not wipe what the last one answered — silence is not a thing said. The visit is
   inserted at `state='agreed'`, and the time is stored **as a moment rather than as the words the
   customer saw**.
   `RETURNING id AS order_id` — and the comment says why that name: the next node binds
   `$json.order_id`, a column called anything else would arrive there as nothing, the insert would
   refuse an empty parameter, and the booking would vanish **because of a rename**.

   `Remember where the job is` also returns **`two_towns`** — whether the town on the booking form
   is the town the price was worked out for. Compared with case and spacing ignored: "kyle" and
   "Kyle" are one town written twice, and a line about that would arrive on almost every booking.
4. **Passes on:** `id`, `order_id`, `agreed`, `booked_event_id` → on to A9.
5. **If it fails:** a redelivery of the same event will not create a second visit.
6. **Protection:** `NOT EXISTS (SELECT 1 FROM visits WHERE booked_event_id = $3)` in the statement
   **plus** the partial unique index `visits_one_per_booking` in `db/schema.sql`. Two levels for the
   same thing — the index holds even when two runs overlapped.

### A9. `Say two towns are on one job` / A10. `Ask about the two towns` / A11. `Remember we asked about the town`

1. `code` v2 (`src/25-visits/say-two-towns-are-on-one-job.js`) / `slack` / `postgres` v2.6
   (`db/25-visits/remember-we-asked-about-the-town.sql`).
2. **Input:** the visit just created; the two towns are read back from `Remember where the job is`
   through `itemMatching` — the step that compared them ran before the visit existed.
3. **Does:** where the towns agree — **nothing, and no line anywhere**. Where they do not, it
   composes a line for `#needs-a-person`: both towns as they were written, and what each of the two
   answers does. `Remember we asked about the town` writes `site_check_ts` and `site_check_channel`
   onto the visit — the message's mark, by which the reaction is later read. Only the first asking
   sticks: a second run will not move the question to a newer message and leave an answer sitting on
   the old one.
4. **Passes on:** the message's mark, onto the visit.
5. **If it fails:** with no mark, branch F finds nothing, and the confirmation to the customer hangs
   for ever, because B1 holds it until `site_agreed` is `true`.
6. **Protection:** `AND site_check_ts IS NULL` in the statement.

   **What this is for.** The address on the agreement comes from the booking form, and rightly so:
   that is where somebody types it with the deed in hand. But nothing noticed when that address was
   in a **different town** from the one the price was worked out for. A job priced for Kyle carries
   Kyle's zone and Kyle's travel; booked to an address in Dallas it is three hundred kilometres for
   a price that never counted the journey, to a town the firm does not cover at all.

## Branch B — the confirmation to the customer

### B1. `Which visits need a word`

1. `postgres` v2.6, `db/25-visits/which-visits-need-a-word.sql`, 1 parameter (`15`).
2. **Input:** the number of minutes to wait.
3. **Does:** `state='agreed'`, `confirmed_at IS NULL`, `agreed_at < now() - 15 min`, the job has an
   address, the job is not `done`/`lost`, **and nobody is being asked about this booking** —
   `site_check_ts IS NULL OR site_agreed IS TRUE`. A booking whose town disagrees with the town the
   price was worked out for waits for an answer; confirming it on a timer would tell the customer
   their visit is on before anybody had looked at where it was.
   The comment: the wait lives here rather than in a pause inside the workflow, so that "which
   bookings are waiting" is a question with an answer **on any row at any moment** — including
   inside a test, which a sleeping execution never is.
   The address comes **from the job, never from the booking form**: somebody who typed a code that
   was not theirs must not find out what is on that job.
4. **Passes on:** `visit_id`, `order_id`, `agreed`, `write_to`, the job's facts, three pieces of
   wording.
5. **If it fails:** the lane falls over.
6. **Protection:** `confirmed_at IS NULL` — the condition that makes the whole branch repeatable.

   **Why fifteen minutes.** People rebook immediately: click a slot, realise it is the wrong time,
   cancel, take another — all inside two minutes. An instant letter would confirm a time that no
   longer exists, and a second would follow it.

### B2. `Write the confirmation` / B3. `Is there a letter to send?`

1. `code` v2 (`src/25-visits/write-the-confirmation.js`) / `if` on `ready_to_send`.
2. **Input:** the row above.
3. **Does:** the time is drawn **in Texas** (`America/Chicago`). The comment: stored as a moment and
   printed in the wrong place, it is the wrong time; the same booking read as half past eight in the
   evening for somebody sitting in Warsaw and half past one in the afternoon for the person driving
   to it.
4. **Passes on:** `ready_to_send`, `why_not`, `subject`, `body`.
5. **If it fails:** an unreadable time or a missing address → `ready_to_send:false`.
6. **Protection:** ✖ **the "no" branch is wired nowhere.** `confirmed_at` stays `NULL`, so **the
   schedule will try again every five minutes, for ever**, and nobody will hear about it. (`write_to`
   is already guaranteed by the statement, so in practice only an unreadable time leads here.)

### B4. `Tell the customer` / B5. `Say the visit was confirmed`

1. `gmail` v2.1 (`send`) / `postgres` v2.6 (`db/25-visits/say-the-visit-was-confirmed.sql`).
2–4. The letter to the customer, then `confirmed_at = now()`.
5. **If it fails:** the letter went and the stamp did not → **five minutes later the customer gets a
   second identical letter**.
6. **Protection:** `AND confirmed_at IS NULL` — the comment says it is there against exactly two
   overlapping runs, or one repeated after a successful send. But the protection works **after** the
   write; the window between sending and stamping is closed by nothing.

## Branch C — checking against the calendar

### C1. `Visits worth checking`

1. `postgres` v2.6, `db/25-visits/visits-worth-checking.sql`, no parameters.
2. **Input:** —
3. **Does:** `state='agreed'`, `booked_event_id IS NOT NULL`, `agreed > now() - 1 day`, the job not
   closed. The comment: a visit agreed by letter has no Google event to check against; and what
   happened last year is history, and checking it against a calendar that has been tidied since
   would rewrite a record of what was true at the time.
4. **Passes on:** `visit_id`, `order_id`, `booked_event_id`, `agreed`, `was_told`.
5–6. Needs no protection as such — it is a read.

### C2. `What is on the calendar`

1. `n8n-nodes-base.googleCalendar` v1.3, `getAll`, `returnAll=true`,
   `timeMin = $now.minus(1,'day')`, `timeMax = $now.plus(120,'days')`, **`showDeleted: true`**,
   `singleEvents: true`.
2. **Input:** —
3. **Does:** reads a window of the calendar. `showDeleted` is critical — without it a cancelled
   event simply disappears, and there is no way to tell it from "outside the window".
4. **Passes on:** the list of events.
5. **If it fails:** the lane falls over.
6. **Protection:** see the next node.

### C3. `What the calendar says now`

1. `code` v2 — `src/25-visits/what-the-calendar-says-now.js`.
2. **Input:** the events plus `$('Visits worth checking').all()`.
3. **Does:** **compares the two sides rather than trusting the trigger**: exactly which events
   Google emits for a reschedule — one updated, or a cancelled and a created — is not something this
   has to know, and not knowing is the point.
   - the event is **not in the window** → `continue`. The comment: this is **not** a cancellation;
     calling it one would strike out every booking far enough ahead;
   - `status='cancelled'` → `gone`;
   - otherwise the times are compared **as moments**, because the database hands back `+00:00` while
     Google says `-05:00`, and as strings they will never agree.
4. **Passes on:** rows with `what_changed` = `moved` or `gone`, plus `now_at`.
5. **If it fails:** an empty `believed` list → returns `[]`.
6. **Protection:** `if (!event) continue` — which is the branch's main protection.

### C4. `Moved, or gone?` / C5. `The visit moved` / C6. `The visit is off`

1. `if` v2.2 (`what_changed === 'moved'`) / `postgres` (`db/25-visits/the-visit-moved.sql`,
   2 parameters) / `postgres` (`db/25-visits/the-visit-is-off.sql`).
2. **Input:** `visit_id`, `now_at`.
3. **Does:** `The visit moved` clears **four** stamps along with the new time, and each has its
   reason in the comment:
   - `confirmed_at = NULL` — the customer holds a letter with a time that is no longer the time;
   - `owner_told_at = NULL` — the owner was told "drive here", and after a move that is wrong;
   - `agreement_url = NULL` — the prepared page carries the old date, and lane E asks for visits
     **without** a page, so leaving it set would leave the old copy **the only one there will ever
     be**;
   - `agreement_started_at = NULL` — otherwise the claim taken by the run that made the old copy
     would hold the visit for half an hour, and the desk would sit idle waiting out a timer that has
     nothing to do with it;
   - `agreed_at = now()` — and the comment explains the subtlest one: two waits are measured from it
     (the quarter hour before confirming, and the half hour after which the owner is told even
     without a page), and left at the original agreement both have already passed at the moment of
     the move — so the briefing would go out with the new time while the page carries the old.

   `The visit is off` sets `state='lapsed'` and **nothing else**. The job stays where it was.
4. **Passes on:** `id`, `order_id`, `agreed` / `state`. Both terminal.
5. **If it fails:** the lane falls over.
6. **Protection:** `AND state='agreed'` in both, plus `AND agreed IS DISTINCT FROM $2` in the move
   (the same event twice changes nothing).
   ✖ **The owner is told neither about a move nor about a cancellation.** The comment in
   `the-visit-is-off.sql` argues that this is a decision rather than an oversight — but it was taken
   when the only channel was the customer's mailbox and no Slack channel existed. Today the owner
   holds a briefing saying "drive on Monday" and **nothing** that says not to.

## Branch D — what the owner is told

### D1. `What the owner has not been told`

1. `postgres` v2.6, `db/25-visits/what-the-owner-has-not-been-told.sql`, no parameters.
2. **Input:** —
3. **Does:** `state='agreed'`, `owner_told_at IS NULL`, **`agreed > now()`** (the comment: this is
   read **before** anybody knocks, so a visit whose hour has gone by has nothing to prepare for —
   had the lane been down over the appointed time, catching up would have announced a visit that had
   already happened), the job not closed, **and
   `(agreement_url IS NOT NULL OR agreed_at < now() - 30 min)`** — so that one message carries
   everything: where to drive, what the job is, and which document to open at the door. The half
   hour is an escape: if whatever makes the page is broken, the owner is told **late rather than
   never**.
   The `ballpark` is taken **only** from the statuses `sent`/`accepted`/`declined`/`expired`: a draft,
   or something waiting on the owner's word, has been seen by nobody, and reading it as "quoted by
   email" would send somebody to a door believing the customer is expecting a figure nobody sent
   them.
4. **Passes on:** `visit_id`, `order_id`, `agreed`, the job's facts, the address from the form,
   `agreement_url`, `ballpark`, `on_site_rates`.
5. **If it fails:** the lane falls over.
6. **Protection:** `owner_told_at IS NULL` — the condition that makes it repeatable.

### D2. `Write what the owner is told` / D3. `Is there something to say?`

1. `code` v2 (`src/25-visits/write-what-the-owner-is-told.js`) / `if` on `ready_to_tell`.
2. **Input:** the row above.
3. **Does:** builds the message for Slack. The comment: this is **for the owner and never for the
   customer** — it says what was quoted and that it is a ballpark, names the firm's own rates for
   the things only a visit settles, and says what to bring; a customer reading it would learn what
   the firm charges itself and what it is unsure of, and neither is theirs.
   The address comes **from the booking form**, and only in its absence the town from the job.
   What to bring is worked out from the job rather than printed the same every time: a list that
   never changes is one nobody reads by the third visit.
   The link to the page is in the same message: the two used to be built apart and knew nothing of
   each other, so a briefing arrived and the document sat on a drive somewhere.
4. **Passes on:** `ready_to_tell`, `why_not`, `message`.
5. **If it fails:** an unreadable time → `ready_to_tell:false`.
6. **Protection:** ✖ **the "no" branch is wired nowhere** — `owner_told_at` stays `NULL`, and the
   schedule will try every ten minutes for ever, silently.

### D4. `Tell the owner` / D5. `Say the owner was told`

1. `slack` v2.3 (`post`, channel `={{ $json.channel }}`, `includeLinkToWorkflow: false`) /
   `postgres` v2.6 (`db/25-visits/say-the-owner-was-told.sql`).
2–4. The message to Slack, then `owner_told_at = now()`.

   **The channel arrives with the message itself** rather than being written into the node. Three
   different composers feed this node, and a channel chosen at the node would be right for at most
   one of them. `Write what the owner is told` sets `#going-out` — where to drive and what to bring;
   `Say two towns are on one job` sets `#needs-a-person`. Until 5 August everything landed in one
   `#visits`: the briefing before driving out sat beside the thing the desk had no right to do
   itself.
5. **If it fails:** Slack accepted it and the stamp did not land → **the same briefing arrives again
   in ten minutes**.
6. **Protection:** `AND owner_told_at IS NULL`. The window between Slack and the stamp is closed by
   nothing. Plus a check in the repository: no Slack node may decide the channel for a message it
   did not write, and no composer may hand over a message without one — the post would go to a
   channel named `undefined`, Slack would refuse it, and the owner would hear nothing at all.

## Branch E — preparing the agreement

### E1. `Claim the visits that need an agreement`

1. `postgres` v2.6, `db/25-visits/claim-the-visits-that-need-an-agreement.sql`, no parameters.
   Together with migration `2026-08-02-42-…` — in `main`, commit `d6d0442`.
2. **Input:** —
3. **Does:** **the asking and the claiming are one statement, on purpose.** The comment: when they
   were two — read, then copy on Drive, then write down that the copy exists — everything between
   the read and the write was unprotected, and copying a document and filling ten places in it lives
   exactly there. Two runs overlapping in those seconds both saw a visit with no page and both made
   one. **Ten copies of one agreement in twenty minutes, every run reporting success.**
   The `UPDATE` takes a row lock, so of two runs one waits, then **checks the conditions again
   against the row the other has just written** — sees `agreement_started_at` set, and claims
   nothing. That is why every condition sits in this statement's `WHERE` rather than in a subquery.
   The half-hour expiry is an escape: a claim that never expires would turn one Google outage into a
   visit **permanently without a page**, and that is a worse trade than the copies it prevents.
   **No price is selected**: a figure from an email, printed on an agreement, is an argument waiting
   at the door.
4. **Passes on:** `visit_id`, `order_id`, `agreed`, the job's facts, the address, `template_id` from
   `reply_templates`.
5. **If it fails:** the lane falls over; the claim is already taken, and the visit waits half an hour.
6. **Protection:** the atomic `UPDATE … RETURNING` is the whole of the branch's protection, and it
   is new.

### E2. `Write the agreement` / E3. `Is there an agreement to prepare?`

1. `code` v2 (`src/25-visits/write-the-agreement.js`) / `if` on `ready_to_prepare`.
2. **Input:** the row above.
3. **Does:** says what each `{{placeholder}}` becomes. It composes no prose — the comment: changing
   the wording of the agreement is a change to **that document**, never to this file, and that is
   precisely why it is a document rather than a template in the database. What is unknown is written
   **in words rather than as a blank**: a printed page saying "not said yet" is a page somebody
   fills in at the door, and a blank is a page whose incompleteness nobody notices.
   The town and the address come **from the booking form first**: a town extracted from prose and an
   address typed with the deed in hand can disagree, and a page naming one town in one line and
   another in the next is a page somebody argues with.
   The file's name carries the job number and the date.
4. **Passes on:** `ready_to_prepare`, `file_name`, `replacements`, `requests` (an array of
   `replaceAllText` for the Docs API).
5. **If it fails:** a missing template or an unreadable time → `ready_to_prepare:false`.
6. **Protection:** ✖ **the "no" branch is wired nowhere — and now that is worse than it used to be.**
   The claim has already been taken in E1, so a visit that could not be composed stays claimed and
   without a page for **half an hour**, and round again, silently. `why_not` is read by nobody.

### E4. `Copy the template`

1. `n8n-nodes-base.googleDrive` v3, `operation=copy`, `fileId = {{ $json.template_id }}` (mode `id`),
   `name = {{ $json.file_name }}`.
2. **Input:** the template's id and the file name.
3. **Does:** makes a copy of the agreement document.
4. **Passes on:** the new document's `id`.
5. **If it fails:** Google refused — the lane falls over. The claim stays taken, and the next attempt
   is **half an hour** away rather than ten minutes.
6. **Protection:** ✖ **the folder parameter is not set** — the copy lands wherever the node puts it
   by default, which is beside the document being copied. Against failure at this step there is no
   protection beyond the claim's half-hour expiry.

### E5. `Fill the copy`

1. `n8n-nodes-base.httpRequest` v4.2, `POST`
   `https://docs.googleapis.com/v1/documents/{{ $json.id }}:batchUpdate`,
   `authentication=predefinedCredentialType`, `nodeCredentialType=googleDocsOAuth2Api`, body
   `JSON.stringify({ requests: $('Write the agreement').item.json.requests })`.
2. **Input:** the copy's id and the replacement requests.
3. **Does:** replaces every `{{…}}` in one call.
4. **Passes on:** `documentId` and `replies` — one per request, each with `occurrencesChanged`.
5. **If it fails:** the copy already exists on Drive **with none of the replacements made**. The lane
   falls over; `agreement_url` is not written, and half an hour later **another** copy is made. The
   orphaned copy is cleaned up by nothing.
6. **Protection:** against the orphaned copy there is none.

### E6. `Did every placeholder land?`

1. `code` v2 — `src/25-visits/did-every-placeholder-land.js`.
2. **Input:** the Docs reply plus `$('Write the agreement').itemMatching(i)`.
3. **Does:** catches a failure invisible from every other direction: the document belongs to the
   owner and the owner edits it; rename `{{material}}` in it, or delete the line, and **nothing
   anywhere fails** — the copy is made, the replacement finds no such text, and the customer is
   handed a page with `{{material}}` printed on it, or with a fact quietly missing.
   An `occurrencesChanged` of zero — or absent, which is the same thing — means the place is not in
   the document.
   `agreement_url` is built **from the id Google replied with**, not from what the lane was
   carrying: the document that gets stamped has to be the one that was actually written to.
4. **Passes on:** `visit_id`, `order_id`, `agreed`, `filled`, `agreement_url`.
5. **If it fails:** throws an exception listing the places that were not filled → `errorWorkflow` →
   90 Errors. The copy stays on Drive and **is not fit to print**, as the error text itself says.
6. **Protection:** `itemMatching(i)`, **never `$('...').item` and never by position** — the comment
   names both mistakes: one linked item would check both visits against the first, and position
   would break on an IF that compacts.
   Covered by `tests/a-copy-with-a-placeholder-left-in-it-is-refused.test.js`.

### E7. `Say where the agreement is`

1. `postgres` v2.6, `db/25-visits/say-where-the-agreement-is.sql`, 3 parameters (`visit_id`,
   `agreement_url`, `agreed`).
2. **Input:** the result of the check.
3. **Does:** `UPDATE visits SET agreement_url = $2 WHERE id=$1 AND agreement_url IS NULL AND
   state='agreed' AND date_trunc('milliseconds', agreed) = date_trunc('milliseconds',
   $3::timestamptz)`.
   The condition on the time is deliberate: copying and filling take seconds, and a customer can
   move their booking inside those seconds; without it a page carrying the old date would land on
   the moved visit, and the `agreement_url` then set would prevent the right one being prepared.
4. **Passes on:** `id`, `order_id`, `agreement_url`. Terminal.
5. **If it fails:** before `d6d0442` a defect lived here: `agreed` arrives through JSON, which holds
   **milliseconds**, while Postgres holds **microseconds** — `12:13:55.395` against
   `12:13:55.395481` never matched, `agreement_url` stayed `null`, and the next run made another
   copy. Ten copies of one agreement in twenty minutes, every run reporting success. **Fixed** in
   #69.
6. **Protection:** `agreement_url IS NULL` against a double stamp. `date_trunc('milliseconds', …)`
   **on both sides** against that difference in precision; the comment in the file states the
   principle: comparing something that did not survive the journey is not a stricter guard, it is a
   guard that is always wrong.
   A millisecond is still far finer than what is being guarded against: two times a customer can
   pick on a booking page are minutes apart at least.
   The round trip used to pass here for the wrong reason — the fixture read the time **back from the
   database**, so nothing was lost. It now sends what the lane sends
   (`asTheLaneSendsIt` in `scripts/conversation-round-trip.mjs`), and has a boundary of its own: a
   check that a time one millisecond out is **not** treated as the same. According to the commit, it
   was watched failing before it was watched passing.

---

## Branch F — the answer about the address

Added 5 August. Reads the reaction somebody left on the line branch A posted.

### F1. `Time to read the answers` / F2. `Which answers are we waiting on`

1. `scheduleTrigger` every 2 minutes / `postgres` v2.6
   (`db/25-visits/which-answers-are-we-waiting-on.sql`, 1 parameter — 30 seconds).
2. **Does:** the visits that have a message mark, an empty `site_agreed`, the state `agreed`, and a
   question asked at least thirty seconds ago. There is no upper bound on purpose: a booking nobody
   answered does not stop mattering, and quietly abandoning the question after a day would neither
   confirm it nor call it off — the visit would simply arrive with nobody having decided anything.
3. **Passes on:** `visit_id`, the mark, the channel, both towns, and **the job's state before any
   change**.

### F3. `Ask Slack what they said`

1. `httpRequest` to `reactions.get`, credential `slackApi`.
2. **Does:** asks Slack what has been put on that message.

### F4. `Read the answer`

1. `code` v2 — `src/25-visits/read-the-answer.js`.
2. **Does:** counts exactly two reactions — `white_check_mark` and `x`, the two named in the message
   itself. Anything else leaves the booking waiting: "somebody put a shrug on it" is not a decision
   about whether a van drives. Both at once is not a decision either — two people can disagree, and
   acting on whichever Slack listed first would mean depending on the order of a list.
3. **If it fails:** if Slack **refuses** to answer, it throws. A booking whose answer cannot be read
   must not look like a booking nobody has answered.

### F5. `Write down the answer`

1. `postgres` v2.6 — `db/25-visits/write-down-the-answer.sql`, 3 parameters.
2. **Does:** writes the answer down and **in the same `UPDATE`** moves the visit to `lapsed` where
   the answer is no. Two statements do not work: Postgres carries out one modification per row per
   statement, and the booking would be left marked as decided and still standing in the calendar.
   On a no, the job is closed (`lost`, with its closing time stamped) and the move is written into
   the history; the state it is closed from arrives as a parameter, because read here it would be
   read **after** this same update, and the history would record a move from `lost` to `lost`.
3. **If yes:** only the yes is written down. Branch B then takes over, because nothing is holding it
   any longer.

---

# Lane 60 — Approval

File: `workflows/60-approval.json`, 6 nodes.

## What wakes it

`Called by router`, `passthrough`. Lane 00 calls it when `route='approval'` — that is,
`category='owner_reply'`, which is **every** letter the desk sent itself. Because of that, most of
what reaches this lane answers nothing, and that is the ordinary case.

## The chain

```
Called by router ─► Accept handoff ─► What this reply answers ─► Did the quote go out?
                                                                    ├──yes─► Say the quote went out ▪
                                                                    └──no──► ✖ NOWHERE (deliberately)
```

The lane changed on 5 August. It used to **send the letter to the customer itself**, having read the
owner's agreement with patterns: `Approved?` → `Send the quote to the customer`. Now the owner sends
it by hand from the draft, and this lane only **recognises that it happened**, and records it.

The difference is not cosmetic. The old shape could not take an edit: `change` was one of the words
that meant no, so "almost right, let me change a word" read as a refusal and sent nothing. And the
other way round — a figure reached the customer whenever a pattern matched.

## What it depends on in the database, and what it changes

**Reads:** `offers` with `status IN ('awaiting_approval','expired')` by `approval_thread_id`, and
`messages` (the body of the letter that was sent).
**Writes:** `messages.status='closed'`, `messages.offer_id`, `offers.status='sent'`, `orders.state`
back out of `lost`, and `order_events` — a `state_change` and an `approved`/`rejected`.

## The nodes of lane 60

### 1. `Accept handoff`

The same statement, with `'closed'` and `'60 Approval — Flooring'`. It sets `closed` **immediately**,
before anything has been decided — because the overwhelming majority of letters arriving here really
do decide nothing. `RETURNING` here also hands back `thread_id` and `body`.

### 2. `What this reply answers`

1. `postgres` v2.6, `db/60-approval/what-this-reply-answers.sql`, 2 parameters.
2. **Input:** `gmail_message_id`, `thread_id`.
3. **Does:** finds the offer this letter answers — **by the figures the letter carries**. `waiting`
   looks for an offer in this thread whose range, printed exactly as the composer prints it
   (`$1,980 to $3,960`), appears in the body of the letter.

   Why not by the thread: the owner writes in the customer's own conversation — that is the whole
   point of leaving the draft there — so an ordinary note of her own ("I'll follow up tomorrow") is
   also an outbound letter in a thread with an offer waiting. The old shape counted it as "the price
   went out", marked `sent` for somebody who had received nothing, and the chasing then stopped
   nudging a draft that was still lying there.

   The figures answer the other half too: a note does not carry them, and a rewritten letter does —
   removing the price from a letter is not sending it, not editing it.

4. **Passes on:** `offer_id`, the totals, `letter_text`, `contact_email`, `the_quote_went_out`.
5. **If it fails:** the lane falls over.
6. **Protection:** strict on purpose. Failing to recognise a price that went out is a nuisance: the
   offer stays waiting and the owner is reminded. Recognising the wrong letter tells a customer's
   job that a price reached them when it did not.

   **An `expired` offer counts too.** Two tellings without an answer close the job — and that is a
   guess about what the silence meant. A letter with the price in it is not a guess: somebody sent
   it.

### 3. `Did the quote go out?` / 4. `Say the quote went out`

1. `if` v2.2 on `the_quote_went_out` / `postgres` v2.6
   (`db/60-approval/say-the-quote-went-out.sql`, 2 parameters).
2. **Input:** the row above.
3. **Does** three things in one statement:
   - `offers.status` → `sent` (from `awaiting_approval` or `expired`);
   - `messages.offer_id` — what the customer actually read is found from the offer rather than
     guessed at later;
   - an `approved` or `rejected` event, depending on whether what was sent matches what the desk
     composed. Compared with whitespace normalised; an unknown is counted as neither.

   **And it brings the job back out of `lost`**, where lane 75 has already closed it: the state
   returns to `quoted`, the closing stamp is cleared, and both moves stay in the history.
4. **Passes on:** `now_sent`, `job_closed`, `she_said`.
5. **If it fails:** the offer stays waiting and the chasing nudges again — the right side to fail on.
6. **Protection:** `status IN (...)` inside the `UPDATE` itself — a second run does not count the
   send twice. The second output of `Did the quote go out?` leads nowhere deliberately: most letters
   arriving here really do answer nothing.

---

# Lane 70 — Catalogue

File: `workflows/70-catalogue.json`, 13 nodes. **The only lane with three different ways into one
chain.**

## What wakes it

| Way in | Type | When |
|---|---|---|
| `By hand` | `manualTrigger` v1 | by hand from the editor |
| `Every morning` | `scheduleTrigger` v1.2 | daily at 06:00 |
| `The sheet says apply it` | `webhook` v2, `authentication=headerAuth` | from a button in the sheet itself |

## The chain

```
By hand ─┐
Every morning ─┼─► What the catalogue accepts ─► Read the price list ─► Read the sheet
The sheet says apply it ─┘                                                   └─► Is the sheet sound?
                                                                                   ├──yes─► Apply the price list ─► Worth a letter?
                                                                                   │                                  ├──yes─► Say what changed ─► Answer the sheet ▪
                                                                                   │                                  └──no──► ✖ NOWHERE
                                                                                   └──no──► Say why nothing changed ─► Answer the sheet ▪
```

## What it depends on in the database, and what it changes

**Reads:** `pg_constraint` (the constraints on `price_bands` themselves, not a copy of them), and
the Google sheet.
**Writes:** `price_bands` (insert / update / deactivate), `price_band_events`.

## The nodes of lane 70

### 1. `What the catalogue accepts`

1. `postgres` v2.6, `db/70-catalogue/what-the-catalogue-accepts.sql`, no parameters.
   **The only file in `db/` with no `.params.json`.**
2. **Input:** —
3. **Does:** reads the lists of permitted values **out of the constraints themselves**, through
   `pg_get_constraintdef` and `regexp_matches`. The comment: the validator needs those lists, and
   **any other way of giving them to it is a copy** — a constant in a Code node, a literal in a file,
   a table seeded to agree with a CHECK. Copies drift, and the first sign of drift here is a sync
   that refuses a row the database would have accepted.
   `COLLATE "C"` so that the answer does not depend on the machine's locale.
4. **Passes on:** `accepts` — an object `{category: […], component: […], unit: […]}`.
5. **If it fails:** the lane falls over.
6. **Protection:** the construction itself is the protection against drift.

### 2. `Read the price list`

1. `n8n-nodes-base.googleSheets` v4.5, document `1HoOd03X…`, sheet `gid=0`,
   `authentication=serviceAccount`, **`onError=continueRegularOutput`, `alwaysOutputData`**.
2. **Input:** —
3. **Does:** reads the sheet.
4. **Passes on:** the sheet's rows.
5. **If it fails:** the error goes out of the **ordinary** output, and `alwaysOutputData` supplies an
   empty item — so a failed read looks exactly like an empty sheet.
6. **Protection:** the next node is built for precisely that — see below.

### 3. `Read the sheet`

1. `code` v2, `mode=runOnceForAllItems` — `src/70-catalogue/read-the-sheet.js`.
2. **Input:** the sheet's rows plus `$('What the catalogue accepts').first().json.accepts`.
3. **Does:** judges the sheet **as a whole, before anything is applied**:
   - zero rows → refusal, worded to say that **an empty answer looks exactly like a failed read** —
     which is the protection against the previous node;
   - a missing column → refusal; every row empty → refusal;
   - per row: the required fields, the spelling of category / component / unit **against the lists
     from the database**, the numbers (with `$`, commas and spaces), `rate_low > 0`,
     `rate_high >= rate_low`, `wastage_pct` a whole number 0–100, `min_charge >= 0`, a **required
     `min_charge` for `component='floor'`**, and duplicates by `category/component/product`;
   - `ignored_columns` — what is in the sheet that nobody asked for.
4. **Passes on:** `sane`, `rows_seen`, `rows_accepted`, `refusals`, `rows`, `said`,
   `ignored_columns`.
5. **If it fails:** it throws nothing — everything becomes `sane:false` with a list of reasons
   **carrying the sheet's row numbers**.
6. **Protection:** "one bad row stops the whole transfer" — the sticky note `Why this is one
   statement` says so directly. Covered by `tests/read-the-sheet.test.js`.

### 4. `Is the sheet sound?` / 5. `Apply the price list`

1. `if` v2.2 on `sane` / `postgres` v2.6, `retryOnFail`,
   `db/70-catalogue/apply-the-price-list.sql`, 1 parameter.
2. **Input:** `JSON.stringify($json.rows)`.
3. **Does:** moves the sheet into `price_bands` **in one statement**. The comment: Postgres does all
   of it or none of it, so there is no state in which half the price list is this month's and half
   last month's; every branch is a CTE **for that reason and no other**.
   - **nothing is deleted**: a row that has gone from the sheet becomes `active=false`, keeping its
     id and every event and quote that pointed at it; bringing it back is an ordinary edit;
   - `ON CONFLICT … DO UPDATE … WHERE (…) IS DISTINCT FROM (…)` — touches only what actually
     changed, so `updated_at` does not move for nothing;
   - `(xmax = 0) AS was_added` — tells an insert from an update;
   - `differences` breaks a change down **into fields**, and each becomes a row in
     `price_band_events`;
   - `count(*) > 0` twice — the comment says this is a **deliberate second copy** of a rule the
     validator already checks, because it answers a different question: whether the catalogue may be
     emptied at all on the strength of an empty argument, **whatever ran before and whoever rewires
     it later**;
   - `active_after` is counted rather than queried: every CTE sees the snapshot from **before** the
     statement.
4. **Passes on:** `rows_in_sheet`, `added`, `changed`, `reactivated`, `deactivated`,
   `events_written`, `active_after`.
5. **If it fails:** `retryOnFail`; a full rollback — there is no such thing as half a price list.
6. **Protection:** the atomicity of one statement, the two `count(*) > 0`, the unique index
   `price_bands_product_unique`, and the constraints `price_bands_floor_has_minimum` and
   `price_bands_range_sane`.

### 6. `Worth a letter?` / 7. `Say what changed` / 8. `Say why nothing changed` / 9. `Answer the sheet`

1. `if` v2.2 / `gmail` v2.1 ×2 / `respondToWebhook` v1.1.
2. **Input:** the totals.
3. **Does:** the condition is
   `(added+changed+reactivated+deactivated) > 0 || !$('Every morning').isExecuted`. So **a daily run
   that changed nothing says nothing**, while a run by hand or from the webhook always answers:
   somebody who pressed a button is owed a reply.
4. **Passes on:** a letter to the owner, and the answer into the webhook.
5. **If it fails:** ✖ the "no" branch is wired nowhere — but here that is the design (silence on a
   schedule). The webhook would in that case **receive no answer**; for the schedule that does not
   matter, for the webhook it would, but the webhook always arrives with `isExecuted=false`, so in
   practice it does not happen.
6. **Protection:** refusal and success have **different** letters, and the letter about a refusal
   quotes the sheet's row numbers.

---

# Lane 75 — Chase

Added 5 August. Drafts never sent.

## What wakes it

A `scheduleTrigger` every 6 hours.

## The chain

```
Every six hours ─► Which drafts are still waiting ─► Say a draft is still waiting
                                                          └─► Chase the owner ─► Say we chased ▪
```

## What it depends on in the database, and what it changes

**Reads:** `offers` with `status='awaiting_approval'`, `orders`, and `order_events` — how many times
the owner has already been told.
**Writes:** `order_events` (`asked` / `the_owner`), and on the second telling `orders.state='lost'`
with its closing time stamped, and `offers.status='expired'`.

## The nodes

### 1. `Which drafts are still waiting`

Offers waiting more than six hours, told about fewer than twice, and not in the last six hours. The
count is per offer rather than per job: a job can be quoted twice, and the second price deserves its
own two tellings.

How long it has waited is `extract(epoch …)/3600` rather than `date_part('hour', …)`: the second
reads the **hour field** of an interval, so four days and four hours came back as `4`, and the line
would have told the owner a price from last week had been waiting since breakfast.

### 2. `Say a draft is still waiting`

A line in `#drafts` — the same channel, because it is the same errand: read it and send it. The
second telling says that it is the last, and that the job is closed as of now.

**Twice, and then never.** A line that repeats until it is obeyed is a line people mute, and a muted
channel is the same as no channel. A job nobody will send a price for is not an open job.

### 3. `Say we chased`

Records the telling, and on the second one closes the job **in the same statement**: a record
without the closing would leave the job open with its two tellings spent, waiting for a third that
never comes.

The closing is not final: if the price is sent after all, lane 60 brings the job back out of `lost`.

---

# Lane 85 — Morning

Built 5 August, **not deployed to production**.

## What wakes it

A `scheduleTrigger` at 06:00 `America/Chicago` — the timezone is set on the lane itself rather than
taken from the machine.

## The chain

```
At six ─► What today and tomorrow hold ─► Write the morning ─► Tell the owner ▪
```

## The nodes

### 1. `What today and tomorrow hold`

Visits at `agreed` for today and tomorrow, the days cut **in the timezone where the work is** rather
than where the server is: a visit at seven in the evening in Austin is already tomorrow in UTC.

Returns **exactly one row, always**, with an array of visits inside it — even an empty one. A node
that returns no rows stops the branch in n8n, and a quiet day would then produce no digest at all.

### 2. `Write the morning`

Today and tomorrow kept apart, the times in Texas. Marks only where there is something to do: not
confirmed to the customer, the address queried, no page to sign yet.

An empty morning says so out loud and adds that the digest arrives every day. That is the whole
point: a morning without one means the desk has stopped, and it is noticed over the first coffee
rather than at the end of the week.

---

# Lane 90 — Errors

File: `workflows/90-errors.json`, 9 nodes.
**The only lane with no `errorWorkflow` in its settings** — deliberately, or a failure here would
call itself.

## What wakes it

Two ways in:
- `Any workflow failed` — `n8n-nodes-base.errorTrigger` v1: **any** failure of any lane, because
  every other lane carries `errorWorkflow="90 Errors — Flooring"`;
- `Called by a lane` — `executeWorkflowTrigger` v1.1, `passthrough`: explicit calls from red outputs
  (lane 00 has four of them).

## The chain

```
Any workflow failed ─┐
                     ├─► Normalise failure ─► Record failure ─► What has not been told
Called by a lane ────┘                                              └─► Is anyone owed a letter?
                                                                          ├──yes─► Tell the owner ─► Say we told ▪
                                                                          └──no──► ✖ NOWHERE (deliberately)
```

## What it depends on in the database, and what it changes

**Reads:** `failures` (what has not been told, and whether anybody was written to recently).
**Writes:** `failures` — a new row, then `notified` / `notified_at`.

## The nodes of lane 90

### 1. `Normalise failure`

1. `code` v2 — `src/90-errors/normalise-failure.js`.
2. **Input:** either the error trigger's object (`execution`, `workflow`) or whatever a lane passed.
3. **Does:** tells the two sources apart by whether `j.execution || j.workflow` is there, and
   reduces both to one shape. It looks for the message in order: `execution.error.message`,
   `lastNodeExecuted`, `_error`, `error` (as a string or an object), `error.description`, and only
   then the literal `'handled failure'`. Truncates to 2,000 characters.
4. **Passes on:** `source` (`error_trigger` / `router_lane`), `workflow_name`, `workflow_id`,
   `execution_id`, `node_name`, `message`, `gmail_message_id`, `payload` (everything raw).
5. **If it fails:** the chain of `||` does not allow an empty message.
6. **Protection:** `payload: j` keeps **everything** raw, so even a shape nobody recognised can be
   read by hand afterwards.

### 2. `Record failure`

1. `postgres` v2.6, `db/90-errors/record-failure.sql`, 8 parameters.
2. **Input:** the normalised failure.
3. **Does:** `INSERT INTO failures (…) RETURNING id, source, node_name, message`.
4. **Passes on:** the failure's id.
5. **If it fails:** ✖ **nobody catches a failure here.** There is no red output and no
   `errorWorkflow`. If the database is unreachable — which is the likeliest reason for being here at
   all — **the failure disappears without trace**.
6. **Protection:** none. It is a deliberate trade against recursion, but the consequence is exactly
   that.

### 3. `What has not been told`

1. `postgres` v2.6, `db/90-errors/what-has-not-been-told.sql`, 1 parameter (`15`).
2. **Input:** the window of silence, in minutes.
3. **Does:** decides **both whether to write and what to write** in one statement, so that the
   decision and the words cannot come apart.
   The rule is **one letter per window of silence, not one per failure**: a workflow failing in a
   loop produces a failure a second, and a hundred letters equal none, because nobody reads the
   hundredth. Grouping by `workflow_name + node_name + message` — "twelve identical timeouts are one
   line with a count, not twelve lines".
4. **Passes on:** `untold`, `told_recently`, `should_tell`, `ids`, `what_broke` (a finished text).
5. **If it fails:** the lane falls over, and nowhere — see point 2 above.
6. **Protection:** `should_tell` = there are untold failures **and** nobody was written to inside
   the window.

### 4. `Is anyone owed a letter?` / 5. `Tell the owner` / 6. `Say we told`

1. `if` v2.2 / `gmail` v2.1 (`send` to `flooring.demo.austin@gmail.com`) / `postgres` v2.6
   (`db/90-errors/say-we-told.sql`, 1 parameter).
2. **Input:** `should_tell` / the text / `ids`.
3. **Does:** a letter with the subject "Flooring: N failure(s) nobody has looked at", the body being
   the grouped list; then `notified=true, notified_at=now()` for **those same ids**.
4. **Passes on:** `id`. Terminal.
5. **If it fails:** the letter did not go → `Say we told` does not run, the rows stay untold, and
   **the next failure carries them along** — the comment says that is the right side to fail on.
6. **Protection:** `AND NOT notified` plus the list of `ids` fixed **before** sending, so a failure
   arriving between the letter and the stamp is not wrongly marked as told.
   The "no" branch leads nowhere — that is the design (silence inside the window).

---

# The lanes that are switched off

## `65 Reminders` — ✖ off, skipped

File: `workflows/65-reminders.json`, 8 nodes. Trigger `Once a day` — a `scheduleTrigger` daily at
09:00. The chain: `Who has gone quiet` (parameters `[5, 21]` — days to the nudge and to letting go)
→ `Nudge or let go?` (a switch) → `Write the nudge` → `Send the nudge` (Gmail `reply`) →
`Say we nudged`; the second branch → `Let it go` (`orders.state='lost'`, `closed_at=now()`).

**The reason it is off, per the handoff: it writes to customers.** The file bears that out —
`Send the nudge` is a `reply` to the customer's address.
It is also one of only three places in the whole system that set `orders.state='lost'` — the other
two being lane 75 and branch F of lane 25.

## `80 Watchman` — ✖ off, skipped

File: `workflows/80-watchman.json`, 7 nodes. Trigger `Every quarter hour` — 15 minutes. The chain:
`Record what is stuck` → `What has not been told` → `Worth telling?` → `Tell the owner` →
`Mark them told`.

It reads `messages WHERE m.status = 'new'`. The sticky note `Why this exists` explains the logic:
`log-inbound-dedupe` writes the row **before anything is decided**, so a letter still at
`status='new'` is the fingerprint of **any failure at all** — a refused write, a node that died, a
run that never finished, a case nobody foresaw.

⚠️ **One disagreement with the handoff.** The handoff says 65 and 80 are off because "they write to
customers". For 65 that is true. **80 writes to the owner** — its `sendTo` is
`flooring.demo.austin@gmail.com`. Why 80 is off is not explained anywhere in the files.

⚠️ **A consequence that touches the whole document.** `messages.status` is written by **seven**
places (`log-inbound-dedupe`, `save-triage`, and five `accept-handoff`), and **read by exactly one
lane — 80, which is off**. Checked by `grep` across every `db/*/*.sql`.
So the main safety net — "a letter arrived and nobody decided anything about it" — is absent right
now, and almost every ✖ NOWHERE below is one it would have caught.

---

# The table of states

## `orders.state`

| Value | Who sets it | Who looks at it | Note |
|---|---|---|---|
| `new` | `find-or-create-an-order.sql` (00) — the schema's DEFAULT | everything that asks "is the job open" | the starting point |
| `quoted` | `write-the-offer.sql` (10) | `accepting-a-ballpark…` (20) | only where the state was **not** already `quoted` |
| `survey_needed` | `accepting-a-ballpark-asks-for-a-visit.sql` (20) | `what-the-invitation-needs.sql` (20) | **not** a closed state — the job is alive |
| `booked` | the same statement, **only** where `offer.kind='firm'` | everything with `state NOT IN ('booked','done','lost')` | **unreachable today** — nothing issues a firm offer |
| `lost` | `say-we-chased.sql` (**75**) — the second telling with no answer; `write-down-the-answer.sql` (**25-F**) — a cross on a mismatched address; `let-it-go.sql` (65, off) | the same | reversible: `say-the-quote-went-out.sql` (60) brings the job back to `quoted` if the price was sent after all |
| `needs_info` | — | — | ✖ permitted by the CHECK, **written nowhere** |
| `negotiating` | — | `accepting-a-ballpark…` reads it as a valid input | ✖ **written nowhere** |
| `done` | — | — | ✖ permitted by the CHECK, **written nowhere** |

Related: `orders.closed_at` is held by the constraint `orders_closed_is_stamped` —
`state IN ('booked','done','lost')` **if and only if** `closed_at IS NOT NULL`.

## `offers.status`

| Value | Who sets it | Who looks at it |
|---|---|---|
| `draft` | `write-the-offer.sql` (10) — DEFAULT | `what-the-quote-letter-needs.sql` (10), `say-the-offer-was-put-forward.sql` (10) |
| `awaiting_approval` | `say-the-offer-was-put-forward.sql` (10) | `what-this-reply-answers.sql` (60), `say-the-quote-went-out.sql` (60), `accepting-a-ballpark…` (20), `which-drafts-are-still-waiting.sql` (75) |
| `sent` | `say-the-quote-went-out.sql` (60) — from `awaiting_approval` **or** `expired` | `accepting-a-ballpark…` (20), `what-the-owner-has-not-been-told.sql` (25) |
| `accepted` | `accepting-a-ballpark…` (20) | the same statement, and 25 |
| `declined` | ✖ **written nowhere** | read by 25 as valid |
| `expired` | `say-we-chased.sql` (75) — the second telling with no answer | `what-this-reply-answers.sql` (60) — accepted alongside `awaiting_approval`, because a letter that was sent overrides a guess about silence |

## `offers.kind` / `offers.outcome`

| Field | Value | Who sets it | Who looks at it |
|---|---|---|---|
| `kind` | `ballpark` | the schema's DEFAULT | `what-the-owner-has-not-been-told.sql` (25) filters on exactly this |
| `kind` | `firm` | ✖ **written nowhere** | `accepting-a-ballpark…` (20) — which is why its `booked` branch is dead |
| `outcome` | `won` | `accepting-a-ballpark…` (20) | the same statement (`WHERE outcome IS NULL`) |
| `outcome` | `lost` | ✖ **written nowhere** | — |

## `visits.state` and the stamps

| State / field | Who sets it | Who looks at it |
|---|---|---|
| `offered` | `say-we-invited-them.sql` (20) | `what-the-invitation-needs.sql` (20); the unique index `visits_one_open_per_order` |
| `agreed` | `write-the-booked-visit.sql` (25-A) | `which-visits-need-a-word`, `visits-worth-checking`, `what-the-owner-has-not-been-told`, `claim-the-visits…`, `say-where-the-agreement-is`, `the-visit-moved`, `the-visit-is-off`, `which-answers-are-we-waiting-on` |
| `lapsed` | `the-visit-is-off.sql` (25-C), `write-down-the-answer.sql` (25-F) | nothing reads it — a terminal state |
| `agreed` (the time) | `write-the-booked-visit` (25-A), shifted by `the-visit-moved` (25-C) | every branch of 25, and `what-today-and-tomorrow-hold` (85) |
| `agreed_at` | `write-the-booked-visit`, **reset** by `the-visit-moved` | `which-visits-need-a-word` (a quarter of an hour), `what-the-owner-has-not-been-told` (half an hour) |
| `confirmed_at` | `say-the-visit-was-confirmed` (25-B) | `which-visits-need-a-word` (25-B), `visits-worth-checking` (25-C), `what-today-and-tomorrow-hold` (85); cleared by `the-visit-moved` |
| `owner_told_at` | `say-the-owner-was-told` (25-D) | `what-the-owner-has-not-been-told` (25-D); cleared by `the-visit-moved` |
| `site_check_ts`, `site_check_channel`, `site_check_asked_at` | `remember-we-asked-about-the-town` (25-A) | `which-answers-are-we-waiting-on` (25-F), `which-visits-need-a-word` (25-B) |
| `site_agreed` | `write-down-the-answer` (25-F) | `which-visits-need-a-word` (25-B) — holds the customer's letter until it is `true`; `what-today-and-tomorrow-hold` (85) — marks it in the digest |
| `agreement_url` | `say-where-the-agreement-is` (25-E) | `claim-the-visits…` (25-E), `what-the-owner-has-not-been-told` (25-D), `what-today-and-tomorrow-hold` (85); cleared by `the-visit-moved` |
| `agreement_started_at` | `claim-the-visits…` (25-E) | only `claim-the-visits…` itself; cleared by `the-visit-moved` |
| `booked_event_id` | `write-the-booked-visit` (25-A) | `visits-worth-checking` (25-C); the unique index `visits_one_per_booking` |

## `messages.status`

| Value | Who sets it | Who looks at it |
|---|---|---|
| `new` | `log-inbound-dedupe.sql` (00) | **only** `record-what-is-stuck.sql` (**80, off**) |
| `triaged` | `save-triage.sql` (00) where `handling <> 'none'` | ✖ **nobody** |
| `closed` | `save-triage.sql` where `handling='none'`; `accept-handoff` (60); `say-we-answered.sql` (10) | ✖ **nobody** |
| `awaiting_pricing` | `accept-handoff` (10) | ✖ **nobody** |
| `awaiting_owner` | `accept-handoff` (20), `accept-handoff` (30) | ✖ **nobody** |
| `awaiting_manual_review` | `accept-handoff` (50) | ✖ **nobody** |
| `digest_pending` | `accept-handoff` (40) | ✖ **nobody** |

**Exactly one value has a reader, and its lane is switched off.**

## `order_events.kind`

| Value | Who sets it | Who looks at it |
|---|---|---|
| `created` | `find-or-create-an-order.sql` (00) | `what-the-second-reader-is-asked.sql` (00) |
| `merged` / `corrected` | `merge-the-facts.sql` (00) | `should-we-ask-and-for-what.sql` (10) — "has anything new arrived since we asked" |
| `state_change` | `write-the-offer` (10), `say-the-offer-was-put-forward` (10), `say-the-quote-went-out` (60) — including the return out of `lost`; `say-we-chased` (75); `write-down-the-answer` (25-F) | the second reader (00) |
| `asked` | `say-we-asked.sql` (10) with `field='still_missing'`; `say-we-chased.sql` (**75**) with `field='the_owner'`; `say-we-nudged.sql` (65, off) | `should-we-ask-and-for-what.sql` (10) — **only** `field='still_missing'`; `which-drafts-are-still-waiting.sql` (75) — **only** `field='the_owner'` |
| `approved` / `rejected` | `say-the-quote-went-out.sql` (60) — whether what was sent matches what the desk composed | nothing reads it; it is the record of how often a person rewrites a price |

## `failures`

| Field | Who sets it | Who looks at it |
|---|---|---|
| the row | `record-failure.sql` (90) | `what-has-not-been-told.sql` (90) |
| `notified` / `notified_at` | `say-we-told.sql` (90) | `what-has-not-been-told.sql` (90) |
| `resolved_at` | ✖ **nobody sets it** — only by hand in the database | `what-has-not-been-told.sql` (90), the index `failures_open_idx` |

---

# Where there is no protection — the summary

Ordered by consequence, not by lane.

| # | Where | What happens | Protection |
|---|---|---|---|
| — | ~~`say-where-the-agreement-is.sql` (25-E)~~ | ~~milliseconds against microseconds~~ | **closed** at `d6d0442` (#69): `date_trunc('milliseconds', …)` on both sides, plus a fixture that was watched failing |
| 2 | `whose-job-is-this.sql` + `Is anybody sure…` (25-A) | a booking that matched **nothing** goes down the "confident" branch with `order_id=NULL` and **disappears without trace** — no visit, no Slack line, no failure. The customer holds a Google confirmation | none; `needs_a_person` covers only "they disagree" and "a code leading nowhere" |
| 3 | `read-the-booking.js` | `nothing_to_go_on` is computed and **read nowhere** — the ready-made signal for №2 lies unused | — |
| 4 | `Show it to the owner instead` (10) | no next node → no `asked` event → `should_ask` is `true` for ever → **the owner receives the same unsent letter on every subsequent letter about that job** | none |
| 5 | `Is the quote ready?` false (10) | a finished offer with no stored wording disappears quietly: `offers` stays `draft`, nobody is written to, no failure is recorded | none |
| — | ~~`Is it worth answering?` false (10)~~ | ~~the letter stays `awaiting_pricing` for ever, silently~~ | **closed 5 August** (#77): the branch leads to `Say a job needs a person` → `#needs-a-person` |
| 7 | `Is there an invitation to send?` false (20) | `why_not` is composed and **read nowhere** — the reason an invitation did not go out reaches nobody | none |
| 8 | `Is there a letter to send?` false (25-B) | `confirmed_at` stays `NULL` → it tries **every five minutes for ever**, silently | none |
| 9 | `Is there something to say?` false (25-D) | `owner_told_at` stays `NULL` → it tries **every ten minutes for ever**, silently | none |
| 10 | `Is there an agreement to prepare?` false (25-E) | the claim is already taken → the visit is claimed and without a page for **half an hour**, and round again, silently | none |
| 11 | `Record failure` (90) | no red output and no `errorWorkflow` → if the database is unreachable (the likeliest reason for being here), **the failure disappears without trace** | none — a deliberate trade against recursion |
| 12 | `What the second reader is asked` (00) | no red output → a failure brings the lane down **after** the gate has done its work: no `Save triage`, no job created. The letter stays at `status='new'` | none |
| 13 | Cancelling and moving a visit (25-C) | the owner is **told nothing** — they hold a briefing saying "drive on Monday" and nothing saying not to. The statement itself argues this is a decision rather than an omission; but it was taken before there was a channel of its own for driving out | none; the decision is worth revisiting |
| 14 | `Copy the template` (25-E) | the folder parameter is not set — copies land beside the document they are copied from | none; this is "branch two" in the handoff |
| 15 | `Fill the copy` (25-E) | a failure leaves **a copy with none of the replacements made** on Drive, and nothing clears it up | none |
| 16 | The window "the letter went, the stamp did not land" | 25-B: a second identical letter to the customer in 5 minutes. 25-D: a second briefing in 10. 20: a second invitation | partial — every stamp has an `IS NULL` guard, but the window between sending and recording is closed by nothing |
| 17 | `Write the offer` (10) | a second run creates **a second offer** (the state change and the event are not doubled) | none on the insert itself |
| 18 | `messages.status` | seven places write it, **one switched-off lane** reads it — the net "it arrived and nobody decided anything" that would catch №5, 8, 9, 10 and 12 is absent | none while 80 is off |
| 19 | `Gmail Trigger` / `A visit was booked` | a missed poll is never caught up: a letter is not re-read, and a booking the trigger did not see, the calendar check will not see either (it looks only at visits the database **already** knows) | none |
| 20 | `find-or-create-an-order.sql` | a collision of the random `booking_code` falls out of the red output and is not regenerated | the space is ≈ 412 million — theory at these volumes |
| 21 | `failures.resolved_at` | nobody sets it — a failure stays "open" for ever until somebody fixes it by hand | none |
| 22 | `Accepting a ballpark…` ↔ `What the invitation needs` (20) | the second branch requires a state the first one sets; the order is held **only by where the nodes sit on the canvas** under `executionOrder=v1` | nothing records the dependency explicitly |
| 23 | `write-the-offer.sql` (10) | the customer writes again while the first draft is unsent → **two live prices on one job**. If the new letter carries different figures, the old draft is already wrong, and sending it is worse than sending nothing | none; the gate counts offers by the letters that carried one, and a draft has carried nothing yet |
| 24 | Mail can quietly stop arriving | it happened once — **fifteen hours**, and nobody found out. `85 Morning` will give the signal by its silence, but it is not deployed, and there is no separate "mail has been quiet for N hours" alarm | none |
| 25 | `deploy.js` | it pushes **only the bodies of nodes**: a changed channel on a Slack node stays as it was. And it pulls the live state back into the repository's files, quietly reverting a change just made | none; both caught by hand on 5 August |

**What is well protected** — for contrast, because the list above reads worse than the system is:
duplicate letters from a redelivery (the unique key on `gmail_message_id`), two visits for one
booking (`booked_event_id` plus a partial index), two open jobs on one thread (a partial index), a
half-applied price list (one statement), facts the model invented (`grounded()`), a figure going out
unread (a draft that cannot send itself, plus `sends_automatically` and `auto_blocked`), and ten
copies of one agreement (the atomic claim).

---

## What this document deliberately does not do

Everything above is a property of the files on disk as of commit `fcd1cb0`, not an observation of
the live system.

What **was checked mechanically** during the update on 5 August: every node of every lane is
mentioned in this document; every node name used here exists in the exports (bar two, named as
history); the Slack channels agree with what the composers set; the parameter count of each
statement agrees with the `$N` inside it.

What was **not** checked: whether the migrations are applied in production (42 and 43 are, **44 is
not**), whether what is deployed in the instance matches the files, and whether 65 and 80 are really
switched off — that is taken from the handoff. Lane `85 Morning` exists in the files and is **absent
from the instance**.
