const CONTRACT_VERSION = 1;

// The mailbox this router reads. Gmail labels a message the desk sends to itself with SENT *and*
// INBOX, so "SENT and not INBOX" reads our own letter as a customer writing in: it lands in a lane,
// grows the thread's history, and changes how the gate judges the next real message. Any lane that
// answers would then answer itself.
//
// The address is not a secret and not a setting a person tunes — it is which mailbox this workflow
// is pointed at, and the Gmail node's credential does not expose it to a Code node. Changing the
// mailbox means changing this line.
const OUR_MAILBOX = 'flooring.demo.austin@gmail.com';

const PLATFORM = /@(?:mail\.)?(angi|angieslist|homeadvisor|thumbtack|yelp|porch|networx|modernize)\./i;
const ADDR = /[\w.!#$%&'*+/=?^`{|}~-]+@[\w-]+(?:\.[\w-]+)+/;
const SUBJECT_TAGS = /^\s*[[(](?:external|ext|spam|suspected spam|bulk|caution|warning)[\])]\s*/i;
const SUBJECT_REPLY = /^\s*(?:re|res|fwd|fw|odp|aw|tr|enc)\s*:\s*/i;
const PLACEHOLDER = /\[(?:image|cid|attachment)\s*:[^\]]*\]/gi;

const QUOTE_PATTERNS = [
  '>',
  '(?:On|Le|Am|El)\\b[^\\n]{0,250}(?:\\n[^\\n]{0,250})?\\bwrote:',
  '[^\\n]{0,250}(?:napisa\\S*\\(a\\)|написав\\(-ла\\)|написала|schrieb|escribió)\\s*:',
  '-{3,}\\s*(?:Original Message|Forwarded message)',
  '_{10,}',
  'From:\\s[^\\n]+\\r?\\n\\s*Sent:\\s',
];
const QUOTE = new RegExp(QUOTE_PATTERNS.map((p) => '\\n\\s*' + p).join('|'));

const hdr = (m, name) => {
  const raw = m.headers?.[name];
  if (!raw) return null;
  return String(raw)
    .replace(new RegExp('^\\s*' + name + '\\s*:\\s*', 'i'), '')
    .replace(/\s+/g, ' ')
    .trim() || null;
};

const htmlToText = (html) => String(html || '')
  .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
  .replace(/<br\s*\/?>/gi, '\n')
  .replace(/<\/(?:p|div|tr|li|h[1-6]|table|blockquote)>/gi, '\n')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
  .replace(/&nbsp;/gi, ' ').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
  .replace(/&quot;/gi, '"').replace(/&apos;/gi, "'")
  .replace(/&amp;/gi, '&')
  .replace(/[ \t]+/g, ' ')
  .replace(/ ?\n ?/g, '\n')
  .replace(/\n{3,}/g, '\n\n')
  .trim();

const dropPlaceholders = (t) => String(t || '')
  .replace(PLACEHOLDER, ' ')
  .replace(/[ \t]+/g, ' ')
  .trim();

const stripQuote = (t) => ('\n' + String(t || '')).split(QUOTE)[0].trim();
const lower = (v) => (v ? String(v).trim().toLowerCase() : null) || null;
const emailIn = (v) => lower(String(v || '').match(ADDR)?.[0]);

const cleanSubject = (s) => {
  let out = String(s || '').trim();
  let prev;
  do {
    prev = out;
    out = out.replace(SUBJECT_TAGS, '').replace(SUBJECT_REPLY, '').trim();
  } while (out !== prev);
  return out;
};

return $input.all().map((item, i) => {
  const m = item.json || {};
  try {
    if (!m.id) throw new Error('missing Gmail message id (m.id)');

    const labels = Array.isArray(m.labelIds) ? m.labelIds : [];

    const from = m.from?.value?.[0] || {};
    const fromEmail = lower(from.address);
    const isOutbound = fromEmail === lower(OUR_MAILBOX)
      || (labels.includes('SENT') && !labels.includes('INBOX'));
    const replyToEmail = emailIn(hdr(m, 'reply-to'));
    const isPlatform = PLATFORM.test(fromEmail || '');
    const contactEmail = isPlatform
      ? (replyToEmail && !PLATFORM.test(replyToEmail) ? replyToEmail : null)
      : fromEmail;

    const bodySource = (m.text && m.text.trim()) ? m.text.trim()
      : (m.html ? htmlToText(m.html) : '');
    const bodyText = dropPlaceholders(bodySource);
    const bodyEmpty = bodyText.length === 0;

    const bin = item.binary || {};
    const imageKeys = Object.keys(bin).filter((k) => /^image\//i.test(bin[k]?.mimeType || ''));
    const pdfKeys = Object.keys(bin).filter((k) => /pdf/i.test(bin[k]?.mimeType || ''));
    const hasPhoto = imageKeys.length > 0;

    const stripped = stripQuote(bodyText);
    const fullyQuoted = !bodyEmpty && stripped.length === 0;
    const bodyClean = fullyQuoted ? bodyText : stripped;

    const subject = m.subject || '';

    return {
      json: {
        contract_version: CONTRACT_VERSION,

        gmail_message_id: m.id,
        internet_message_id: m.messageId || null,
        thread_id: m.threadId || m.id || '',
        is_outbound: isOutbound,

        from_email: fromEmail,
        from_name: from.name || '',
        reply_to_email: replyToEmail,
        contact_email: contactEmail,
        to_emails: (m.to?.value || []).map((v) => lower(v.address)).filter(Boolean),
        cc_emails: (hdr(m, 'cc') || '').match(new RegExp(ADDR.source, 'g'))?.map(lower) || [],

        source: isOutbound ? 'owner_sent' : (isPlatform ? 'platform' : 'gmail_direct'),
        needs_sender_extraction: isPlatform && !contactEmail,

        subject,
        subject_normalized: cleanSubject(subject),
        nothing_to_read: bodyEmpty && cleanSubject(subject).trim().length === 0,
        body_raw: bodySource,
        body_html: m.html || '',
        body_clean: bodyClean,
        body_empty: bodyEmpty,
        body_fully_quoted: fullyQuoted,
        body_raw_length: bodySource.length,
        body_clean_length: bodyClean.length,

        has_photo: hasPhoto,
        image_count: imageKeys.length,
        pdf_count: pdfKeys.length,
        attachment_names: Object.keys(bin),

        sender_date: m.date || null,

        auto_submitted: hdr(m, 'auto-submitted'),
        precedence: hdr(m, 'precedence'),
        list_unsubscribe: hdr(m, 'list-unsubscribe') ? true : false,

        raw_email: {
          from: m.from?.text || null,
          subject,
          sender_date: m.date || null,
          message_id: m.messageId || null,
          references: m.references || null,
          in_reply_to: m.inReplyTo || null,
          labels: m.labelIds || null,
          size_estimate: m.sizeEstimate || null,
        },
      },
      binary: item.binary,
      pairedItem: { item: i },
    };
  } catch (e) {
    return {
      json: {
        _error: e.message,
        contract_version: CONTRACT_VERSION,
        gmail_message_id: m.id || null,
        subject: m.subject || null,
        from_email: lower(m.from?.value?.[0]?.address) || null,
        _raw_keys: Object.keys(m),
      },
      pairedItem: { item: i },
    };
  }
});
