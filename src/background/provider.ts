import type { Account, Draft, MailView, ThreadAction, ThreadDetail, ThreadSummary } from '../shared/types';

/** What one account lists: a view, narrowed to Gmail's Primary tab or not. */
export interface ListSpec {
  view: 'unread-inbox' | 'inbox';
  primary: boolean;
}

/** The global view, with the account's own Primary-only choice on top. */
export function specFor(view: MailView, account: Pick<Account, 'primaryOnly'>): ListSpec {
  return {
    view: view === 'inbox' ? 'inbox' : 'unread-inbox',
    primary: view === 'unread-primary' || !!account.primaryOnly,
  };
}

/** The Gmail search for a spec. `unread` asks for only the unread part, whatever the view. */
export function queryFor(spec: ListSpec, unread = spec.view === 'unread-inbox'): string {
  return ['in:inbox', unread ? 'is:unread' : '', spec.primary ? 'category:primary' : ''].filter(Boolean).join(' ');
}

/** One source of mail. Gmail for real accounts, an in-memory mailbox for the demo. */
export interface Provider {
  /** The current list for a spec. `previous` lets a provider reuse what hasn't changed. */
  sync(account: Account, spec: ListSpec, previous: ThreadSummary[]): Promise<ThreadSummary[]>;
  modify(account: Account, threadIds: string[], action: ThreadAction): Promise<void>;
  /**
   * Marks every unread conversation the spec covers as read, not only the
   * ones Glance has listed. Returns what it changed, for restoreUnread.
   */
  markAllRead(account: Account, spec: ListSpec): Promise<string[]>;
  restoreUnread(account: Account, ids: string[]): Promise<void>;
  getThread(account: Account, threadId: string): Promise<ThreadDetail>;
  /** Standard base64 of the attachment's bytes. */
  getAttachment(account: Account, messageId: string, attachmentId: string): Promise<string>;
  send(account: Account, draft: Draft): Promise<void>;
  search(account: Account, query: string): Promise<ThreadSummary[]>;
}

/**
 * How a spec is listed. Labels where they can do it: Gmail's label index is
 * always current, while its search index can lag, so `is:unread` may still
 * return a thread for a while after it was read. Primary has no label that
 * means "Primary" for people without inbox tabs, so it stays a search.
 */
export function listFor(spec: ListSpec): { labelIds?: string[]; q?: string } {
  if (spec.primary) return { q: queryFor(spec) };
  return { labelIds: spec.view === 'inbox' ? ['INBOX'] : ['INBOX', 'UNREAD'] };
}

const OTHER_TABS = ['CATEGORY_SOCIAL', 'CATEGORY_PROMOTIONS', 'CATEGORY_UPDATES', 'CATEGORY_FORUMS'];

/** Whether a thread, by its own labels, belongs in a spec's list. The last word over any list. */
export function fits(t: ThreadSummary, spec: ListSpec): boolean {
  if (!t.labelIds.includes('INBOX')) return false;
  if (spec.view === 'unread-inbox' && !t.unread) return false;
  return !spec.primary || !t.labelIds.some((l) => OTHER_TABS.includes(l));
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
