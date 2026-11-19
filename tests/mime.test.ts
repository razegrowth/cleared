import { assert, test } from 'vitest';
import {
  base64UrlToBytes,
  buildRawMessage,
  decodeEntities,
  displayAddress,
  parseAddressList,
  parseMessage,
  toBase64Url,
} from '../src/shared/mime.ts';
import { inQuietHours, isVip } from '../src/shared/format.ts';
import { DEFAULT_SETTINGS } from '../src/shared/types.ts';

const b64url = (s: string) => toBase64Url(new TextEncoder().encode(s));
const fromB64url = (s: string) => new TextDecoder().decode(base64UrlToBytes(s));

test('parses address lists with quoted commas and bare addresses', () => {
  const list = parseAddressList('"Lee, Jordan" <jordan@x.com>, sam@y.com, Priya Raman <priya@z.com>');
  assert.deepEqual(list, [
    { name: 'Lee, Jordan', email: 'jordan@x.com' },
    { name: 'sam', email: 'sam@y.com' },
    { name: 'Priya Raman', email: 'priya@z.com' },
  ]);
});

test('display addresses round-trip through the parser', () => {
  const people = [
    { name: 'Lee, Jordan', email: 'jordan@x.com' },
    { name: 'sam', email: 'sam@y.com' },
  ];
  assert.deepEqual(parseAddressList(people.map(displayAddress).join(', ')), people);
});

test('builds a reply that threads and survives non-ASCII', () => {
  const raw = buildRawMessage(
    {
      accountId: 'me@x.com',
      threadId: 't1',
      to: 'José Núñez <jose@x.com>',
      cc: '',
      bcc: '',
      subject: 'Re: Café ☕',
      body: 'Gracias — see you <soon>',
      inReplyTo: '<abc@mail>',
      references: '<root@mail>',
      quote: { attribution: 'On Mon, José wrote:', html: '<p>hola</p>' },
    },
    { name: 'Alex Rivera', email: 'me@x.com' },
  );
  const text = fromB64url(raw);
  assert.match(text, /^From: Alex Rivera <me@x\.com>\r\n/);
  assert.match(text, /\r\nTo: =\?UTF-8\?B\?[^?]+\?= <jose@x\.com>\r\n/);
  assert.match(text, /\r\nSubject: =\?UTF-8\?B\?[^?]+\?=\r\n/);
  assert.match(text, /\r\nIn-Reply-To: <abc@mail>\r\n/);
  assert.match(text, /\r\nReferences: <root@mail> <abc@mail>\r\n/);
  assert.notMatch(text, /\r\nCc:/);
  // Headers end at the first blank line; nothing empty sneaks in before it.
  const [head] = text.split('\r\n\r\n');
  assert.ok(head.split('\r\n').every((l) => l.length > 0));

  const html = text.split('Content-Type: text/html; charset="UTF-8"\r\nContent-Transfer-Encoding: base64\r\n\r\n')[1].split('\r\n--')[0];
  const decoded = new TextDecoder().decode(Uint8Array.from(atob(html.replace(/\r\n/g, '')), (c) => c.charCodeAt(0)));
  assert.match(decoded, /Gracias — see you &lt;soon&gt;/);
  assert.match(decoded, /<blockquote[^>]*><p>hola<\/p><\/blockquote>/);
});

test('parses a Gmail message: richest alternative, attachments, inline images', () => {
  const msg = parseMessage({
    id: 'm1',
    threadId: 't1',
    labelIds: ['INBOX', 'UNREAD'],
    snippet: 'Tom &amp; Jerry',
    internalDate: '1700000000000',
    payload: {
      mimeType: 'multipart/mixed',
      headers: [
        { name: 'From', value: 'Tom <tom@x.com>' },
        { name: 'To', value: 'me@x.com' },
        { name: 'Subject', value: 'Hi' },
        { name: 'Message-ID', value: '<id@x>' },
      ],
      parts: [
        {
          mimeType: 'multipart/alternative',
          parts: [
            { mimeType: 'text/plain', headers: [{ name: 'Content-Type', value: 'text/plain; charset=utf-8' }], body: { data: b64url('plain ünïcode') } },
            { mimeType: 'text/html', headers: [], body: { data: b64url('<b>rich</b><img src="cid:logo">') } },
          ],
        },
        {
          mimeType: 'image/png',
          filename: 'logo.png',
          headers: [{ name: 'Content-ID', value: '<logo>' }, { name: 'Content-Disposition', value: 'inline' }],
          body: { attachmentId: 'att1', size: 10 },
        },
        {
          mimeType: 'application/pdf',
          filename: 'deck.pdf',
          headers: [{ name: 'Content-Disposition', value: 'attachment; filename="deck.pdf"' }],
          body: { attachmentId: 'att2', size: 2048 },
        },
      ],
    },
  });
  assert.equal(msg.text, 'plain ünïcode');
  assert.equal(msg.html, '<b>rich</b><img src="cid:logo">');
  assert.equal(msg.unread, true);
  assert.equal(msg.snippet, 'Tom & Jerry');
  assert.equal(msg.messageIdHeader, '<id@x>');
  assert.deepEqual(
    msg.attachments.map((a) => [a.filename, a.inline, a.contentId]),
    [
      ['logo.png', true, 'logo'],
      ['deck.pdf', false, undefined],
    ],
  );
});

test('decodes entities in snippets', () => {
  assert.equal(decodeEntities('It&#39;s &quot;fine&quot; &lt;3'), 'It\'s "fine" <3');
});

test('quiet hours wrap past midnight', () => {
  const s = { ...DEFAULT_SETTINGS, quietHours: { enabled: true, start: '22:00', end: '08:00' } };
  const at = (h: number, m = 0) => new Date(2026, 0, 1, h, m);
  assert.equal(inQuietHours(s, at(23)), true);
  assert.equal(inQuietHours(s, at(3)), true);
  assert.equal(inQuietHours(s, at(8)), false);
  assert.equal(inQuietHours(s, at(12)), false);
  assert.equal(inQuietHours({ ...s, quietHours: { ...s.quietHours, enabled: false } }, at(23)), false);
});

test('VIPs match addresses and whole domains', () => {
  const s = { ...DEFAULT_SETTINGS, vips: ['ceo@acme.com', 'client.com', '@partner.io'] };
  assert.equal(isVip(s, 'CEO@acme.com'), true);
  assert.equal(isVip(s, 'other@acme.com'), false);
  assert.equal(isVip(s, 'pm@client.com'), true);
  assert.equal(isVip(s, 'pm@mail.client.com'), true);
  assert.equal(isVip(s, 'pm@notclient.com'), false);
  assert.equal(isVip(s, 'x@partner.io'), true);
});
