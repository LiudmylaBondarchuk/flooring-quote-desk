const asked = $('Should we ask, and for what').first().json;
const message = $('Accept handoff').first().json;

// Joining strings, nothing else. Every sentence here was written by a person and is stored in
// reply_templates, so changing how the firm sounds is an edit in the database rather than a
// deployment — and nothing in this file decides what the firm says.
const body = String(asked.body || '').trim();
const signature = String(asked.signature || '');

if (!body) {
  throw new Error(`no template is stored for ${asked.template_key || 'this combination'} — `
    + 'reply_templates is missing a row, and sending an empty letter is worse than sending none');
}

// A lead forwarded by a platform with no reply-to leaves no address to answer. The router already
// says so through needs_sender_extraction, and a letter with nobody in the To field is not a letter.
// Refusing here sends it to the error lane, where a person can find the address; sending it would
// fail somewhere less visible, or worse, reach the platform instead of the customer.
const to = String(message.contact_email || '').trim();
if (!to) {
  throw new Error('there is no address to answer: this arrived through a platform that forwarded '
    + 'no reply-to, and the customer cannot be reached without one');
}

const subject = String(message.subject || '').trim();
const replying = /^re:/i.test(subject) ? subject : `Re: ${subject || 'your enquiry'}`;

return [{
  json: {
    gmail_message_id: asked.gmail_message_id,
    order_id: asked.order_id,
    asking_for: asked.asking_for,
    to,
    thread_id: message.thread_id,
    subject: replying,
    body: body + signature,
  },
}];
