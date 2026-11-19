import { accessToken, AuthError } from './auth';
import { mapLimit, VIEW_LIST, type Provider } from './provider';
import {
  base64UrlToBytes,
  buildRawMessage,
  bytesToBase64,
  decodeEntities,
  firstName,
  header,
  parseAddress,
  parseMessage,
  type GmailMessage,
  type GmailPart,
} from '../shared/mime';
import type { Account, ThreadAction, ThreadSummary } from '../shared/types';

const API = 'https://gmail.googleapis.com/gmail/v1/users/me';

/** Messages Gmail itself leaves out of a conversation: drafts, and anything in Trash or Spam. */
const shown = (m: GmailMessage) => !m.labelIds?.some((l) => l === 'DRAFT' || l === 'TRASH' || l === 'SPAM');

export class GmailError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'GmailError';
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface CallOptions {
  method?: string;
  body?: unknown;
  query?: Record<string, string | number | string[] | undefined>;
}

/**
 * One Gmail API call, with the token refreshed on a 401 and backoff on rate
 * limits, server errors and dropped connections. Four tries, then it gives up.
 */
async function call<T>(accountId: string, path: string, opts: CallOptions = {}): Promise<T> {
  const url = new URL(API + path);
  for (const [k, v] of Object.entries(opts.query ?? {})) {
    if (v === undefined) continue;
    for (const item of Array.isArray(v) ? v : [v]) url.searchParams.append(k, String(item));
  }

  let forceRefresh = false;
  let lastError: Error = new Error('Gmail request failed');
  for (let attempt = 0; attempt < 4; attempt++) {
    const token = await accessToken(accountId, forceRefresh);
    let res: Response;
    try {
      res = await fetch(url, {
        method: opts.method ?? 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: opts.body ? JSON.stringify(opts.body) : undefined,
      });
    } catch (e) {
      lastError = new GmailError(navigator.onLine ? 'Could not reach Gmail.' : 'You’re offline.', 0);
      await sleep(backoff(attempt));
      continue;
    }

    if (res.ok) return (res.status === 204 ? undefined : await res.json()) as T;

    const body = await res.json().catch(() => ({}));
    const message: string = body?.error?.message ?? `Gmail answered ${res.status}`;
    const reason: string | undefined = body?.error?.errors?.[0]?.reason;

    if (res.status === 401 && !forceRefresh) {
      forceRefresh = true;
      continue;
    }
    if (res.status === 401) throw new AuthError('Gmail rejected this account’s sign-in. Reconnect it.');

    const rateLimited =
      res.status === 429 || (res.status === 403 && /rateLimit|userRateLimit|quota/i.test(reason ?? ''));
    if (rateLimited || res.status >= 500) {
      lastError = new GmailError(message, res.status);
      const retryAfter = Number(res.headers.get('Retry-After'));
      await sleep(retryAfter > 0 ? retryAfter * 1000 : backoff(attempt));
      continue;
    }
    throw new GmailError(message, res.status);
  }
  throw lastError;
}

function backoff(attempt: number) {
  return Math.min(8000, 500 * 2 ** attempt) + Math.random() * 300;
}

// ---------------------------------------------------------------- summaries

interface GmailThread {
  id: string;
  historyId: string;
  snippet?: string;
  messages?: GmailMessage[];
}

function summarize(account: Account, thread: GmailThread): ThreadSummary {
  const all = thread.messages ?? [];
  const messages = all.filter(shown);
  const list = messages.length ? messages : all;
  const own = account.email.toLowerCase();
  const labels = new Set(list.flatMap((m) => m.labelIds ?? []));

  const senders = list.map((m) => parseAddress(header(m.payload?.headers, 'From') ?? '') ?? { name: '', email: '' });
  const participants: string[] = [];
  for (const s of senders) {
    const label = s.email.toLowerCase() === own ? 'me' : firstName(s);
    if (!participants.includes(label)) participants.push(label);
  }

  const latestUnread = [...list].reverse().find((m) => m.labelIds?.includes('UNREAD'));
  const pickIndex = latestUnread
    ? list.indexOf(latestUnread)
    : (() => {
        for (let i = senders.length - 1; i >= 0; i--) if (senders[i].email.toLowerCase() !== own) return i;
        return senders.length - 1;
      })();

  const last = list[list.length - 1];
  return {
    id: thread.id,
    accountId: account.id,
    historyId: thread.historyId,
    subject: header(list[0]?.payload?.headers, 'Subject') || '(no subject)',
    snippet: decodeEntities(last?.snippet ?? thread.snippet ?? ''),
    from: senders[pickIndex] ?? { name: 'Unknown', email: '' },
    participants,
    date: Number(last?.internalDate ?? Date.now()),
    messageCount: list.length,
    unread: labels.has('UNREAD'),
    starred: labels.has('STARRED'),
    important: labels.has('IMPORTANT'),
    hasAttachment: list.some((m) => m.payload?.mimeType === 'multipart/mixed'),
    labelIds: [...labels],
  };
}

async function getSummary(account: Account, id: string): Promise<ThreadSummary | null> {
  try {
    const thread = await call<GmailThread>(account.id, `/threads/${id}`, {
      query: { format: 'metadata', metadataHeaders: ['From', 'Subject', 'Date'] },
    });
    return summarize(account, thread);
  } catch (e) {
    // A thread deleted between list and get is not an error worth showing.
    if (e instanceof GmailError && e.status === 404) return null;
    throw e;
  }
}

async function listSummaries(
  account: Account,
  by: { q?: string; labelIds?: string[] },
  max: number,
  previous: ThreadSummary[] = [],
) {
  const list = await call<{ threads?: { id: string; historyId: string }[] }>(account.id, '/threads', {
    query: { q: by.q, labelIds: by.labelIds, maxResults: max },
  });
  const known = new Map(previous.map((t) => [t.id, t]));
  const results = await mapLimit(list.threads ?? [], 6, async (t) => {
    const cached = known.get(t.id);
    // Same historyId: nothing in the thread has changed since we last looked.
    if (cached && cached.historyId === t.historyId) return cached;
    return getSummary(account, t.id);
  });
  return results.filter((t): t is ThreadSummary => !!t).sort((a, b) => b.date - a.date);
}

// ---------------------------------------------------------------- bodies

/** Very large text bodies come back as attachments; fetch them so the message renders. */
async function inlineLargeBodies(accountId: string, messageId: string, part: GmailPart | undefined) {
  if (!part) return;
  const pending: Promise<void>[] = [];
  const walk = (p: GmailPart) => {
    p.parts?.forEach(walk);
    if (!p.filename && p.body?.attachmentId && !p.body.data && /^text\/(html|plain)$/i.test(p.mimeType ?? '')) {
      pending.push(
        call<{ data: string }>(accountId, `/messages/${messageId}/attachments/${p.body.attachmentId}`).then((a) => {
          p.body = { ...p.body, data: a.data, attachmentId: undefined };
        }),
      );
    }
  };
  walk(part);
  await Promise.all(pending);
}

async function lastMessageId(accountId: string, threadId: string): Promise<string | undefined> {
  const t = await call<GmailThread>(accountId, `/threads/${threadId}`, { query: { format: 'minimal' } });
  const msgs = (t.messages ?? []).filter(shown);
  return msgs[msgs.length - 1]?.id;
}

async function modifyOne(accountId: string, threadId: string, action: ThreadAction) {
  const thread = (add: string[], remove: string[]) =>
    call(accountId, `/threads/${threadId}/modify`, {
      method: 'POST',
      body: { addLabelIds: add, removeLabelIds: remove },
    });
  const lastMessage = async (add: string[]) => {
    // Gmail marks unread and stars on the newest message, not the whole thread.
    const id = await lastMessageId(accountId, threadId);
    if (id) await call(accountId, `/messages/${id}/modify`, { method: 'POST', body: { addLabelIds: add } });
  };

  switch (action) {
    case 'read':
      return thread([], ['UNREAD']);
    case 'unread':
      return lastMessage(['UNREAD']);
    case 'archive':
      return thread([], ['INBOX']);
    case 'inbox':
      return thread(['INBOX'], []);
    case 'star':
      return lastMessage(['STARRED']);
    case 'unstar':
      return thread([], ['STARRED']);
    case 'spam':
      return thread(['SPAM'], ['INBOX']);
    case 'unspam':
      return thread(['INBOX'], ['SPAM']);
    case 'trash':
      return call(accountId, `/threads/${threadId}/trash`, { method: 'POST' });
    case 'untrash':
      return call(accountId, `/threads/${threadId}/untrash`, { method: 'POST' });
  }
}

export const gmail: Provider = {
  sync(account, view, previous) {
    return listSummaries(account, VIEW_LIST[view], 100, previous);
  },

  async modify(account, threadIds, action) {
    await mapLimit(threadIds, 4, (id) => modifyOne(account.id, id, action));
  },

  async getThread(account, threadId) {
    const thread = await call<GmailThread>(account.id, `/threads/${threadId}`, { query: { format: 'full' } });
    const all = thread.messages ?? [];
    // A thread opened from Trash or Spam search results still shows its messages.
    const raw = all.some(shown) ? all.filter(shown) : all;
    await Promise.all(raw.map((m) => inlineLargeBodies(account.id, m.id, m.payload)));
    const messages = raw.map(parseMessage);
    return {
      id: thread.id,
      accountId: account.id,
      subject: messages[0]?.subject ?? '(no subject)',
      messages,
      starred: raw.some((m) => m.labelIds?.includes('STARRED')),
    };
  },

  async getAttachment(account, messageId, attachmentId) {
    const a = await call<{ data: string }>(account.id, `/messages/${messageId}/attachments/${attachmentId}`);
    return bytesToBase64(base64UrlToBytes(a.data));
  },

  async send(account, draft) {
    const raw = buildRawMessage(draft, { name: account.name, email: account.email });
    await call(account.id, '/messages/send', { method: 'POST', body: { raw, threadId: draft.threadId } });
  },

  search(account, query) {
    return listSummaries(account, { q: query }, 25);
  },
};
