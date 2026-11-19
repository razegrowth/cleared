import { assert, test } from 'vitest';
import { replyDraft } from '../src/ui/reply.ts';
import type { Account, MessageDetail, ThreadDetail } from '../src/shared/types.ts';

const me: Account = { id: 'me@x.com', email: 'me@x.com', name: 'Me', color: '#000', status: 'ok', notify: true };

const msg = (over: Partial<MessageDetail>): MessageDetail => ({
  id: 'm',
  threadId: 't',
  from: { name: 'A', email: 'a@x.com' },
  to: [],
  cc: [],
  replyTo: [],
  date: 0,
  subject: 'Plan',
  snippet: '',
  attachments: [],
  unread: false,
  ...over,
});

const thread = (messages: MessageDetail[]): ThreadDetail => ({ id: 't', accountId: me.id, subject: 'Plan', messages, starred: false });

test('reply goes to the last sender, honouring Reply-To', () => {
  const d = replyDraft(
    me,
    thread([msg({ from: { name: 'Bot', email: 'noreply@x.com' }, replyTo: [{ name: 'Help', email: 'help@x.com' }], to: [me], messageIdHeader: '<1@x>' })]),
    false,
  );
  assert.equal(d.to, 'Help <help@x.com>');
  assert.equal(d.subject, 'Re: Plan');
  assert.equal(d.inReplyTo, '<1@x>');
});

test('reply all copies everyone else, never me, never twice', () => {
  const d = replyDraft(
    me,
    thread([
      msg({
        from: { name: 'A', email: 'a@x.com' },
        to: [me, { name: 'B', email: 'b@x.com' }],
        cc: [{ name: 'A again', email: 'A@x.com' }, { name: 'C', email: 'c@x.com' }],
      }),
    ]),
    true,
  );
  assert.equal(d.to, 'A <a@x.com>');
  assert.equal(d.cc, 'B <b@x.com>, C <c@x.com>');
});

test('if I sent the last message, reply goes to its recipients', () => {
  const d = replyDraft(me, thread([msg({ from: { name: 'Me', email: 'me@x.com' }, to: [{ name: 'Dana W', email: 'dana@x.com' }], subject: 'Re: Plan' })]), false);
  assert.equal(d.to, 'Dana W <dana@x.com>');
  assert.equal(d.subject, 'Re: Plan');
});
