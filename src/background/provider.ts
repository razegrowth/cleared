import type { Account, Draft, MailView, ThreadAction, ThreadDetail, ThreadSummary } from '../shared/types';

/** One source of mail. Gmail for real accounts, an in-memory mailbox for the demo. */
export interface Provider {
  /** The current list for a view. `previous` lets a provider reuse what hasn't changed. */
  sync(account: Account, view: MailView, previous: ThreadSummary[]): Promise<ThreadSummary[]>;
  modify(account: Account, threadIds: string[], action: ThreadAction): Promise<void>;
  getThread(account: Account, threadId: string): Promise<ThreadDetail>;
  /** Standard base64 of the attachment's bytes. */
  getAttachment(account: Account, messageId: string, attachmentId: string): Promise<string>;
  send(account: Account, draft: Draft): Promise<void>;
  search(account: Account, query: string): Promise<ThreadSummary[]>;
}

export const VIEW_QUERY: Record<MailView, string> = {
  'unread-inbox': 'in:inbox is:unread',
  'unread-primary': 'in:inbox is:unread category:primary',
  inbox: 'in:inbox',
};

/**
 * How each view is listed. Labels where they can do it: Gmail's label index is
 * always current, while its search index can lag, so `is:unread` may still
 * return a thread for a while after it was read. Primary has no label that
 * means "Primary" for people without inbox tabs, so it stays a search.
 */
export const VIEW_LIST: Record<MailView, { labelIds?: string[]; q?: string }> = {
  'unread-inbox': { labelIds: ['INBOX', 'UNREAD'] },
  'unread-primary': { q: VIEW_QUERY['unread-primary'] },
  inbox: { labelIds: ['INBOX'] },
};

const OTHER_TABS = ['CATEGORY_SOCIAL', 'CATEGORY_PROMOTIONS', 'CATEGORY_UPDATES', 'CATEGORY_FORUMS'];

/** Whether a thread, by its own labels, belongs in a view. The last word over any list. */
export function fitsView(t: ThreadSummary, view: MailView): boolean {
  if (!t.labelIds.includes('INBOX')) return false;
  if (view === 'inbox') return true;
  if (!t.unread) return false;
  return view === 'unread-inbox' || !t.labelIds.some((l) => OTHER_TABS.includes(l));
}

/**
 * What's worth a notification after a sync: an unread conversation new to the
 * list, or a new message in one that was already there. Mail older than ten
 * minutes before the last check is old news, not an arrival.
 */
export function findArrivals(previous: ThreadSummary[], fresh: ThreadSummary[], lastSync: number): ThreadSummary[] {
  const before = new Map(previous.map((t) => [t.id, t]));
  return fresh.filter((t) => {
    if (!t.unread || t.date <= lastSync - 10 * 60_000) return false;
    const was = before.get(t.id);
    return !was || t.messageCount > was.messageCount || t.date > was.date;
  });
}

export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
