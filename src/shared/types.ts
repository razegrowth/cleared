export interface Person {
  name: string;
  email: string;
}

export type AccountStatus = 'ok' | 'syncing' | 'needs-auth' | 'error';

export interface Account {
  /** Lowercased email address. Stable across sign-ins. */
  id: string;
  email: string;
  name: string;
  picture?: string;
  color: string;
  status: AccountStatus;
  error?: string;
  lastSync?: number;
  notify: boolean;
  /** List only Gmail's Primary tab for this account, whatever the global view. */
  primaryOnly?: boolean;
  /** Sample mail with no Google connection, for trying Glance out. */
  demo?: boolean;
}

export interface ThreadSummary {
  id: string;
  accountId: string;
  historyId: string;
  subject: string;
  snippet: string;
  /** Who the row is "from": the latest sender who isn't the account owner. */
  from: Person;
  /** Distinct sender first names, oldest first, as Gmail shows them. */
  participants: string[];
  date: number;
  messageCount: number;
  unread: boolean;
  starred: boolean;
  important: boolean;
  hasAttachment: boolean;
  labelIds: string[];
}

export interface Attachment {
  id: string;
  messageId: string;
  filename: string;
  mimeType: string;
  size: number;
  contentId?: string;
  inline: boolean;
}

export interface MessageDetail {
  id: string;
  threadId: string;
  from: Person;
  to: Person[];
  cc: Person[];
  replyTo: Person[];
  date: number;
  subject: string;
  snippet: string;
  html?: string;
  text?: string;
  attachments: Attachment[];
  unread: boolean;
  messageIdHeader?: string;
  references?: string;
}

export interface ThreadDetail {
  id: string;
  accountId: string;
  subject: string;
  messages: MessageDetail[];
  starred: boolean;
}

export type MailView = 'unread-inbox' | 'unread-primary' | 'inbox';

export interface Settings {
  view: MailView;
  pollMinutes: number;
  theme: 'system' | 'light' | 'dark';
  remoteImages: 'ask' | 'always';
  markReadOnOpen: boolean;
  notifications: boolean;
  vipOnly: boolean;
  vips: string[];
  quietHours: { enabled: boolean; start: string; end: string };
  undoSendSeconds: number;
  /** Show each thread's whole latest message in the list, not a two-line snippet. */
  fullPreviews: boolean;
  /** How large mail text is drawn, in the list and the reader: 1 is as designed. */
  textScale: number;
  /** What the toolbar button opens: the popup, or the side panel (and closes it again). */
  surface: 'popup' | 'panel';
  /** A row of tabs above the list, one per inbox. Off: 1–9 and A still switch inboxes. */
  inboxTabs: boolean;
  /** Inbox tabs show the whole address (alex@northwind.example), not just the part before the @. */
  fullAddresses: boolean;
  /** Overrides for the build-time OAuth client, for teammates building without a .env. */
  clientId?: string;
  clientSecret?: string;
}

export const DEFAULT_SETTINGS: Settings = {
  view: 'unread-inbox',
  pollMinutes: 1,
  theme: 'system',
  remoteImages: 'ask',
  markReadOnOpen: true,
  notifications: true,
  vipOnly: false,
  vips: [],
  quietHours: { enabled: false, start: '22:00', end: '08:00' },
  undoSendSeconds: 5,
  fullPreviews: false,
  inboxTabs: false,
  surface: 'popup',
  fullAddresses: false,
  textScale: 1,
};

export interface Snooze {
  accountId: string;
  threadId: string;
  until: number;
  subject: string;
}

/** Everything the UI renders from. Lives in chrome.storage.local, one key each. */
export interface MailState {
  accounts: Account[];
  threads: Record<string, ThreadSummary[]>;
  settings: Settings;
  snoozes: Snooze[];
}

export type ThreadAction =
  | 'read'
  | 'unread'
  | 'archive'
  | 'inbox'
  | 'trash'
  | 'untrash'
  | 'star'
  | 'unstar'
  | 'spam'
  | 'unspam';

export interface Draft {
  accountId: string;
  threadId?: string;
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  body: string;
  inReplyTo?: string;
  references?: string;
  /** Quoted original, appended below the reply as HTML. */
  quote?: { html: string; attribution: string };
}

/** Requests from the UI to the background worker. */
export type Request =
  | { type: 'refresh'; accountId?: string }
  | { type: 'addAccount' }
  | { type: 'addDemo' }
  | { type: 'removeAccount'; accountId: string }
  | { type: 'reauth'; accountId: string }
  | { type: 'updateAccount'; accountId: string; patch: Partial<Pick<Account, 'color' | 'notify' | 'primaryOnly'>> }
  | { type: 'markAllRead'; accountId: string }
  | { type: 'act'; action: ThreadAction; items: ThreadRef[] }
  | { type: 'snooze'; items: ThreadRef[]; until: number }
  | { type: 'undo'; undoId: string }
  | { type: 'getThread'; accountId: string; threadId: string }
  | { type: 'getAttachment'; accountId: string; messageId: string; attachmentId: string }
  | { type: 'send'; draft: Draft }
  | { type: 'cancelSend'; sendId: string }
  | { type: 'search'; query: string }
  | { type: 'updateSettings'; patch: Partial<Settings> }
  | { type: 'openPanel'; windowId?: number }
  | { type: 'testNotification' }
  | { type: 'colorScheme'; dark: boolean };

export interface ThreadRef {
  accountId: string;
  threadId: string;
}

export type Response<T = unknown> = { ok: true; data: T } | { ok: false; error: string };

export interface ActResult {
  undoId?: string;
}

export interface SendResult {
  sendId: string;
  delayMs: number;
}
