import { assert, test } from 'vitest';
import { fits, queryFor, specFor } from '../src/background/provider.ts';
import type { MailView, ThreadSummary } from '../src/shared/types.ts';

const fitsView = (t: ThreadSummary, view: MailView, primaryOnly = false) => fits(t, specFor(view, { primaryOnly }));

const t = (unread: boolean, labelIds: string[]): ThreadSummary => ({
  id: 't',
  accountId: 'a',
  historyId: '1',
  subject: '',
  snippet: '',
  from: { name: '', email: '' },
  participants: [],
  date: 0,
  messageCount: 1,
  unread,
  starred: false,
  important: false,
  hasAttachment: false,
  labelIds,
});

test('a read thread never shows in an unread view, whatever search said', () => {
  assert.isFalse(fitsView(t(false, ['INBOX']), 'unread-inbox'));
  assert.isFalse(fitsView(t(false, ['INBOX', 'CATEGORY_PERSONAL']), 'unread-primary'));
  assert.isTrue(fitsView(t(false, ['INBOX']), 'inbox'));
});

test('unread inbox threads show; archived ones do not', () => {
  assert.isTrue(fitsView(t(true, ['INBOX', 'UNREAD']), 'unread-inbox'));
  assert.isFalse(fitsView(t(true, ['UNREAD']), 'unread-inbox'));
  assert.isFalse(fitsView(t(true, ['UNREAD']), 'inbox'));
});

test('Primary leaves out the other tabs but keeps inboxes without tabs', () => {
  assert.isTrue(fitsView(t(true, ['INBOX', 'UNREAD', 'CATEGORY_PERSONAL']), 'unread-primary'));
  assert.isTrue(fitsView(t(true, ['INBOX', 'UNREAD']), 'unread-primary'));
  assert.isFalse(fitsView(t(true, ['INBOX', 'UNREAD', 'CATEGORY_PROMOTIONS']), 'unread-primary'));
});

test('an account set to Primary only narrows whatever the global view is', () => {
  const promo = t(true, ['INBOX', 'UNREAD', 'CATEGORY_PROMOTIONS']);
  assert.isTrue(fitsView(promo, 'unread-inbox'));
  assert.isFalse(fitsView(promo, 'unread-inbox', true));
  assert.isFalse(fitsView({ ...promo, unread: false }, 'inbox', true));
  assert.isTrue(fitsView(t(false, ['INBOX', 'CATEGORY_PERSONAL']), 'inbox', true));
  assert.equal(queryFor(specFor('unread-inbox', { primaryOnly: true })), 'in:inbox is:unread category:primary');
  assert.equal(queryFor(specFor('inbox', { primaryOnly: true }), true), 'in:inbox is:unread category:primary');
  assert.equal(queryFor(specFor('inbox', {})), 'in:inbox');
});

import { stripQuotedText } from '../src/ui/preview.ts';

test('full previews drop the quoted reply chain from plain-text mail', () => {
  const text = 'Sounds good, see you then.\n\nSam\n\nOn Tue, Nov 18, 2026 at 9:41 AM Alex Rivera <alex@x.com>\nwrote:\n> Lunch Thursday?\n> 12:30?';
  assert.equal(stripQuotedText(text).trim(), 'Sounds good, see you then.\n\nSam');
  assert.equal(stripQuotedText('Hi\n> quoted\nthere').trim(), 'Hi\nthere');
});

import { findArrivals } from '../src/background/provider.ts';

test('a new reply in a thread already unread counts as new mail', () => {
  const now = Date.now();
  const old = { ...t(true, ['INBOX', 'UNREAD']), date: now - 60_000, messageCount: 1 };
  const replied = { ...old, date: now, messageCount: 2 };
  assert.lengthOf(findArrivals([old], [replied], now - 30_000), 1);
  assert.lengthOf(findArrivals([old], [old], now - 30_000), 0);
});

test('a new thread notifies; old or read mail does not', () => {
  const now = Date.now();
  const fresh = { ...t(true, ['INBOX', 'UNREAD']), id: 'new', date: now };
  const ancient = { ...fresh, id: 'old', date: now - 3 * 3600_000 };
  const read = { ...fresh, id: 'read', unread: false };
  assert.deepEqual(findArrivals([], [fresh, ancient, read], now - 60_000).map((x) => x.id), ['new']);
});
