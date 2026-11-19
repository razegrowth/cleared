import type { Attachment, Draft, MessageDetail, Person } from './types';

// ---------------------------------------------------------------- base64url

export function base64UrlToBytes(data: string): Uint8Array {
  const b64 = data.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  const bin = atob(padded);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export function decodeBase64Url(data: string, charset = 'utf-8'): string {
  const bytes = base64UrlToBytes(data);
  try {
    return new TextDecoder(charset, { fatal: false }).decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

export function toBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const utf8 = (s: string) => new TextEncoder().encode(s);

// ---------------------------------------------------------------- addresses

/**
 * Splits an address header into people. Handles quoted names with commas,
 * bare addresses, and "Name <addr>" forms.
 */
export function parseAddressList(value: string | undefined): Person[] {
  if (!value) return [];
  const out: Person[] = [];
  let current = '';
  let quoted = false;
  let angle = 0;
  for (const ch of value) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && ch === '<') angle++;
    else if (!quoted && ch === '>') angle = Math.max(0, angle - 1);
    if (ch === ',' && !quoted && angle === 0) {
      const p = parseAddress(current);
      if (p) out.push(p);
      current = '';
    } else current += ch;
  }
  const last = parseAddress(current);
  if (last) out.push(last);
  return out;
}

export function parseAddress(raw: string): Person | null {
  const s = raw.trim();
  if (!s) return null;
  const m = s.match(/^(.*)<([^>]+)>\s*$/);
  if (m) {
    const name = m[1].trim().replace(/^"(.*)"$/, '$1').replace(/\\"/g, '"').trim();
    const email = m[2].trim();
    return { name: name || email.split('@')[0], email };
  }
  return { name: s.split('@')[0], email: s };
}

export function formatAddress(p: Person): string {
  if (!p.name || p.name === p.email) return p.email;
  const needsQuote = /[",.;:<>@()[\]\\]/.test(p.name);
  const name = needsQuote ? `"${p.name.replace(/"/g, '\\"')}"` : p.name;
  return `${encodeHeaderWord(name)} <${p.email}>`;
}

/** For text people read and edit, like the composer's To field. */
export function displayAddress(p: Person): string {
  if (!p.name || p.name === p.email || p.name === p.email.split('@')[0]) return p.email;
  const name = /[",;<>@]/.test(p.name) ? `"${p.name.replace(/"/g, '\\"')}"` : p.name;
  return `${name} <${p.email}>`;
}

export function firstName(p: Person): string {
  const n = p.name || p.email;
  if (n.includes('@')) return n.split('@')[0];
  return n.split(/\s+/)[0];
}

// ---------------------------------------------------------------- headers

/** RFC 2047 encoded-word for non-ASCII header text. */
export function encodeHeaderWord(s: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x20-\x7e]*$/.test(s)) return s;
  return `=?UTF-8?B?${bytesToBase64(utf8(s))}?=`;
}

interface GmailHeader {
  name: string;
  value: string;
}

export function header(headers: GmailHeader[] | undefined, name: string): string | undefined {
  const lower = name.toLowerCase();
  return headers?.find((h) => h.name.toLowerCase() === lower)?.value;
}

// ---------------------------------------------------------------- parsing

export interface GmailPart {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: GmailHeader[];
  body?: { attachmentId?: string; size?: number; data?: string };
  parts?: GmailPart[];
}

export interface GmailMessage {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  historyId?: string;
  internalDate?: string;
  payload?: GmailPart;
}

function charsetOf(part: GmailPart): string {
  const ct = header(part.headers, 'Content-Type') ?? '';
  const m = ct.match(/charset="?([^";\s]+)"?/i);
  return m ? m[1].toLowerCase() : 'utf-8';
}

/**
 * Walks a Gmail payload and pulls out the best HTML and plain-text bodies
 * plus attachments. Inside multipart/alternative the last part wins, as the
 * MIME spec orders alternatives from plainest to richest.
 */
export function parseMessage(msg: GmailMessage): MessageDetail {
  const headers = msg.payload?.headers;
  let html: string | undefined;
  let text: string | undefined;
  const attachments: Attachment[] = [];

  const walk = (part: GmailPart) => {
    const type = (part.mimeType ?? '').toLowerCase();
    const disposition = (header(part.headers, 'Content-Disposition') ?? '').toLowerCase();
    const contentId = header(part.headers, 'Content-ID')?.replace(/^<|>$/g, '');
    const isAttachment = !!part.filename || disposition.startsWith('attachment');

    if (part.parts?.length) {
      part.parts.forEach(walk);
      return;
    }
    if (isAttachment && part.body?.attachmentId) {
      attachments.push({
        id: part.body.attachmentId,
        messageId: msg.id,
        filename: part.filename || 'attachment',
        mimeType: type,
        size: part.body.size ?? 0,
        contentId,
        inline: !!contentId && !disposition.startsWith('attachment'),
      });
      return;
    }
    if (isAttachment && part.body?.data && contentId) {
      // Small inline images arrive in the body itself.
      attachments.push({
        id: `data:${type};base64,${bytesToBase64(base64UrlToBytes(part.body.data))}`,
        messageId: msg.id,
        filename: part.filename || 'image',
        mimeType: type,
        size: part.body.size ?? 0,
        contentId,
        inline: true,
      });
      return;
    }
    if (!part.body?.data) return;
    if (type === 'text/html') html = (html ?? '') + decodeBase64Url(part.body.data, charsetOf(part));
    else if (type === 'text/plain' && !isAttachment) text = (text ?? '') + decodeBase64Url(part.body.data, charsetOf(part));
  };
  if (msg.payload) walk(msg.payload);

  return {
    id: msg.id,
    threadId: msg.threadId,
    from: parseAddress(header(headers, 'From') ?? '') ?? { name: 'Unknown', email: '' },
    to: parseAddressList(header(headers, 'To')),
    cc: parseAddressList(header(headers, 'Cc')),
    replyTo: parseAddressList(header(headers, 'Reply-To')),
    date: Number(msg.internalDate ?? Date.now()),
    subject: header(headers, 'Subject') ?? '(no subject)',
    snippet: decodeEntities(msg.snippet ?? ''),
    html,
    text,
    attachments,
    unread: msg.labelIds?.includes('UNREAD') ?? false,
    messageIdHeader: header(headers, 'Message-ID') ?? header(headers, 'Message-Id'),
    references: header(headers, 'References'),
  };
}

/** Gmail snippets arrive HTML-escaped. */
export function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

// ---------------------------------------------------------------- building

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function textToHtml(text: string): string {
  const linked = escapeHtml(text).replace(
    /\bhttps?:\/\/[^\s<]+[^\s<.,;:!?)\]'"]/g,
    (url) => `<a href="${url}">${url}</a>`,
  );
  return linked.replace(/\r?\n/g, '<br>');
}

function wrap76(b64: string): string {
  return b64.replace(/(.{76})/g, '$1\r\n');
}

/** Builds an RFC 2822 message from a draft, ready for messages.send. */
export function buildRawMessage(draft: Draft, from: Person): string {
  const boundary = `glance_${crypto.randomUUID().replace(/-/g, '')}`;
  const toList = parseAddressList(draft.to);
  const ccList = parseAddressList(draft.cc);
  const bccList = parseAddressList(draft.bcc);

  const quoteHtml = draft.quote
    ? `<br><div class="gmail_quote"><div dir="ltr" class="gmail_attr">${escapeHtml(draft.quote.attribution)}<br></div>` +
      `<blockquote class="gmail_quote" style="margin:0 0 0 .8ex;border-left:1px #ccc solid;padding-left:1ex">${draft.quote.html}</blockquote></div>`
    : '';
  const html = `<div dir="ltr">${textToHtml(draft.body)}</div>${quoteHtml}`;
  const quoteText = draft.quote ? `\r\n\r\n${draft.quote.attribution}\r\n` : '';

  const headers = [
    `From: ${formatAddress(from)}`,
    toList.length ? `To: ${toList.map(formatAddress).join(', ')}` : '',
    ccList.length ? `Cc: ${ccList.map(formatAddress).join(', ')}` : '',
    bccList.length ? `Bcc: ${bccList.map(formatAddress).join(', ')}` : '',
    `Subject: ${encodeHeaderWord(draft.subject)}`,
    draft.inReplyTo ? `In-Reply-To: ${draft.inReplyTo}` : '',
    draft.references || draft.inReplyTo
      ? `References: ${[draft.references, draft.inReplyTo].filter(Boolean).join(' ')}`
      : '',
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ].filter(Boolean);

  const lines = [
    ...headers,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    wrap76(bytesToBase64(utf8(draft.body + quoteText))),
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    wrap76(bytesToBase64(utf8(html))),
    `--${boundary}--`,
    '',
  ];

  return toBase64Url(utf8(lines.join('\r\n')));
}
