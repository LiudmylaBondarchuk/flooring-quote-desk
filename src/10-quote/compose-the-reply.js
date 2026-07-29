// Where a letter goes when nobody may read it first. The same address the rest of the system
// writes to, and the only address in this file that is not the customer's.
const OWNER = 'flooring.demo.austin@gmail.com';

const asked = $('Should we ask, and for what').first().json;

// Joining strings, nothing else. Every sentence here was written by a person and is stored in
// reply_templates, so changing how the firm sounds is an edit in the database rather than a
// deployment -- and nothing in this file decides what the firm says.
const body = String(asked.body || '').trim();
const signature = String(asked.signature || '');

if (!body) {
  throw new Error(`no template is stored for ${asked.template_key || 'this combination'} -- `
    + 'reply_templates is missing a row, and sending an empty letter is worse than sending none');
}

// A lead forwarded by a platform with no reply-to leaves no address to answer. The router already
// says so through needs_sender_extraction, and a letter with nobody in the To field is not a letter.
// Refusing here sends it to the error lane, where a person can find the address; sending it would
// fail somewhere less visible, or worse, reach the platform instead of the customer.
const to = String(asked.contact_email || '').trim();
if (!to) {
  throw new Error('there is no address to answer: this arrived through a platform that forwarded '
    + 'no reply-to, and the customer cannot be reached without one');
}

// Where it goes is the stored sentence's decision, not this file's. A sentence that may not go
// out alone still gets written -- it goes to the owner, marked as not sent, so she can read it and
// decide. Nothing is silently dropped and nothing reaches a customer unread.
const alone = asked.may_go_alone === true || asked.may_go_alone === 't';

// The customer's copy is a reply, so the subject and the thread are Gmail's to continue and not
// ours to invent -- one message id is the whole of it. Only the owner's copy needs a subject,
// because it starts a new letter, and it says what it is at a glance.
return [{
  json: {
    gmail_message_id: asked.gmail_message_id,
    order_id: asked.order_id,
    asking_for: asked.asking_for,
    to: alone ? to : OWNER,
    reaches_the_customer: alone,
    thread_id: alone ? asked.thread_id : null,
    subject: alone ? null : `Not sent -- a question for ${to}`,
    body: alone ? body + signature
      : `This was composed for ${to} and not sent, because the wording it uses is marked as `
        + `needing a person first.\n\nAsking for: ${asked.asking_for}\n\n---\n\n${body}${signature}`,
  },
}];
