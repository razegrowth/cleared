import { AuthError, forgetTokens, signIn } from './auth';
import { demo, DEMO_ACCOUNTS, resetDemo } from './demo';
import { gmail } from './gmail';
import { findArrivals, fits, specFor, type Provider } from './provider';
import { gmailThreadUrl, inQuietHours, isVip } from '../shared/format';
import { getKey, loadState, withDefaults } from '../shared/store';
import type {
  Account,
  ActResult,
  Draft,
  SendResult,
  Settings,
  Snooze,
  ThreadAction,
  ThreadRef,
  ThreadSummary,
} from '../shared/types';

const ACCOUNT_COLORS = ['#3b82f6', '#f97316', '#10b981', '#a855f7', '#ec4899', '#eab308', '#14b8a6', '#ef4444'];

const providerFor = (a: Account): Provider => (a.demo ? demo : gmail);

// ---------------------------------------------------------------- storage

/** Read-modify-write on storage, one at a time, so concurrent syncs never lose an update. */
let queue: Promise<unknown> = Promise.resolve();
function locked<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn);
  queue = run.catch(() => {});
  return run;
}

async function getSettings(): Promise<Settings> {
  return withDefaults(await getKey<Partial<Settings>>('settings'));
}

async function getAccounts(): Promise<Account[]> {
  return (await getKey<Account[]>('accounts')) ?? [];
}

async function getAccount(id: string): Promise<Account> {
  const a = (await getAccounts()).find((x) => x.id === id);
  if (!a) throw new Error('That account is no longer connected.');
  return a;
}

function updateAccounts(fn: (accounts: Account[]) => Account[]) {
  return locked(async () => {
    const accounts = fn(await getAccounts());
    await chrome.storage.local.set({ accounts });
    return accounts;
  });
}

function patchAccount(id: string, patch: Partial<Account>) {
  return updateAccounts((all) => all.map((a) => (a.id === id ? { ...a, ...patch } : a)));
}

function updateThreads(fn: (threads: Record<string, ThreadSummary[]>) => Record<string, ThreadSummary[]>) {
  return locked(async () => {
    const threads = fn((await getKey<Record<string, ThreadSummary[]>>('threads')) ?? {});
    await chrome.storage.local.set({ threads });
    await updateBadge();
    return threads;
  });
}

function updateSnoozes(fn: (s: Snooze[]) => Snooze[]) {
  return locked(async () => {
    const snoozes = fn((await getKey<Snooze[]>('snoozes')) ?? []);
    await chrome.storage.local.set({ snoozes });
    return snoozes;
  });
}

// ---------------------------------------------------------------- accounts

async function upsertAccount(profile: { email: string; name: string; picture?: string }, extra: Partial<Account> = {}) {
  const id = profile.email.toLowerCase();
  await updateAccounts((all) => {
    const existing = all.find((a) => a.id === id);
    if (existing) {
      return all.map((a) => (a.id === id ? { ...a, ...profile, ...extra, status: 'ok', error: undefined } : a));
    }
    const used = new Set(all.map((a) => a.color));
    const color = ACCOUNT_COLORS.find((c) => !used.has(c)) ?? ACCOUNT_COLORS[all.length % ACCOUNT_COLORS.length];
    return [...all, { id, ...profile, color, notify: true, status: 'ok', ...extra }];
  });
  return id;
}

export async function addAccount() {
  const profile = await signIn();
  const id = await upsertAccount(profile);
  await syncAccount(id);
}

export async function addDemo() {
  for (const a of DEMO_ACCOUNTS) {
    await resetDemo(a.id);
    await upsertAccount(a, { demo: true, color: a.color });
  }
  await syncAll();
}

export async function reauth(accountId: string) {
  const account = await getAccount(accountId);
  if (account.demo) return syncAccount(accountId);
  const profile = await signIn(account.email);
  await upsertAccount(profile);
  chrome.notifications.clear(`r|${accountId}`);
  await syncAccount(accountId);
}

export async function removeAccount(accountId: string) {
  const account = await getAccount(accountId);
  if (account.demo) await resetDemo(accountId);
  else await forgetTokens(accountId);
  await updateAccounts((all) => all.filter((a) => a.id !== accountId));
  await updateThreads((t) => {
    const { [accountId]: _, ...rest } = t;
    return rest;
  });
  await updateSnoozes((s) => s.filter((x) => x.accountId !== accountId));
}

export async function updateAccount(accountId: string, patch: Partial<Pick<Account, 'color' | 'notify' | 'primaryOnly'>>) {
  const before = await getAccount(accountId);
  await patchAccount(accountId, patch);
  if ('primaryOnly' in patch && !!patch.primaryOnly !== !!before.primaryOnly) await syncAccount(accountId);
}

// ---------------------------------------------------------------- sync

/**
 * Threads acted on in the last few seconds. Gmail can still list them for a
 * moment after the change, so a sync that lands in that window must not bring
 * an archived thread back.
 */
const hidden = new Map<string, number>();
const hideKey = (r: ThreadRef) => `${r.accountId}|${r.threadId}`;
function isHidden(t: ThreadSummary) {
  const until = hidden.get(hideKey({ accountId: t.accountId, threadId: t.id }));
  if (!until) return false;
  if (until < Date.now()) {
    hidden.delete(hideKey({ accountId: t.accountId, threadId: t.id }));
    return false;
  }
  return true;
}

const syncing = new Map<string, Promise<void>>();

export function syncAccount(accountId: string): Promise<void> {
  let run = syncing.get(accountId);
  if (!run) {
    run = doSync(accountId).finally(() => syncing.delete(accountId));
    syncing.set(accountId, run);
  }
  return run;
}

async function doSync(accountId: string) {
  const account = await getAccount(accountId);
  const settings = await getSettings();
  const previous = ((await getKey<Record<string, ThreadSummary[]>>('threads')) ?? {})[accountId] ?? [];
  if (account.status !== 'syncing' && !account.lastSync) await patchAccount(accountId, { status: 'syncing' });

  try {
    const spec = specFor(settings.view, account);
    const fresh = (await providerFor(account).sync(account, spec, previous)).filter((t) => !isHidden(t) && fits(t, spec));
    const arrivals = account.lastSync ? findArrivals(previous, fresh, account.lastSync) : [];
    await updateThreads((all) => ({ ...all, [accountId]: fresh }));
    await patchAccount(accountId, { status: 'ok', error: undefined, lastSync: Date.now() });
    if (arrivals.length) await notifyArrivals(account, arrivals, settings);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.warn(`[glance] sync failed for ${accountId}:`, e);
    const signedOut = e instanceof AuthError;
    await patchAccount(accountId, signedOut ? { status: 'needs-auth', error: message } : { status: 'error', error: message });
    await updateBadge();
    if (signedOut && account.status !== 'needs-auth') notifySignedOut(account);
  }
}

/**
 * Says, once, that an account stopped working. Otherwise nobody finds out
 * until they happen to open Glance and wonder why it's quiet.
 */
function notifySignedOut(account: Account) {
  chrome.notifications.create(`r|${account.id}`, {
    type: 'basic',
    iconUrl: notificationIcon(),
    title: `Sign in to ${account.email} again`,
    message: 'Google signed this account out of Glance. Its mail won’t update until you sign in.',
    buttons: [{ title: 'Sign in' }],
    requireInteraction: true,
    priority: 2,
  });
}

/**
 * Whether a check is running, for the refresh button's spin. Kept in storage
 * so every open Glance sees checks it didn't start: the timed ones too.
 */
let checks = 0;
async function setChecking(delta: 1 | -1) {
  checks = Math.max(0, checks + delta);
  await chrome.storage.local.set({ checking: checks > 0 ? Date.now() : 0 }).catch(() => {});
}

export async function syncAll() {
  await setChecking(1);
  try {
    await processSnoozes();
    const accounts = await getAccounts();
    await Promise.all(accounts.map((a) => syncAccount(a.id)));
  } finally {
    await setChecking(-1);
  }
}

// ---------------------------------------------------------------- actions

const INVERSE: Record<ThreadAction, ThreadAction> = {
  read: 'unread',
  unread: 'read',
  archive: 'inbox',
  inbox: 'archive',
  trash: 'untrash',
  untrash: 'trash',
  star: 'unstar',
  unstar: 'star',
  spam: 'unspam',
  unspam: 'spam',
};

const undos = new Map<string, () => Promise<void>>();
function registerUndo(fn: () => Promise<void>): string {
  const id = crypto.randomUUID();
  undos.set(id, fn);
  setTimeout(() => undos.delete(id), 60_000);
  return id;
}

export async function undo(undoId: string) {
  const fn = undos.get(undoId);
  if (!fn) throw new Error('Too late to undo that.');
  undos.delete(undoId);
  await fn();
}

function groupByAccount(items: ThreadRef[]): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const i of items) m.set(i.accountId, [...(m.get(i.accountId) ?? []), i.threadId]);
  return m;
}

/** Does this action take the thread out of the current list? */
function removes(action: ThreadAction, settings: Settings) {
  if (action === 'archive' || action === 'trash' || action === 'spam') return true;
  return action === 'read' && settings.view !== 'inbox';
}

async function applyLocally(items: ThreadRef[], action: ThreadAction, settings: Settings) {
  const ids = new Set(items.map(hideKey));
  const touched = (t: ThreadSummary) => ids.has(hideKey({ accountId: t.accountId, threadId: t.id }));
  if (removes(action, settings)) items.forEach((i) => hidden.set(hideKey(i), Date.now() + 20_000));
  await updateThreads((all) => {
    const next: Record<string, ThreadSummary[]> = {};
    for (const [acc, list] of Object.entries(all)) {
      next[acc] = list
        .filter((t) => !(touched(t) && removes(action, settings)))
        .map((t) => {
          if (!touched(t)) return t;
          if (action === 'star') return { ...t, starred: true };
          if (action === 'unstar') return { ...t, starred: false };
          if (action === 'read') return { ...t, unread: false };
          if (action === 'unread') return { ...t, unread: true };
          return t;
        });
    }
    return next;
  });
}

async function perform(items: ThreadRef[], action: ThreadAction) {
  const settings = await getSettings();
  await applyLocally(items, action, settings);
  const failures: string[] = [];
  await Promise.all(
    [...groupByAccount(items)].map(async ([accountId, threadIds]) => {
      try {
        const account = await getAccount(accountId);
        await providerFor(account).modify(account, threadIds, action);
      } catch (e) {
        failures.push(e instanceof Error ? e.message : String(e));
        threadIds.forEach((threadId) => hidden.delete(hideKey({ accountId, threadId })));
        await syncAccount(accountId);
      }
    }),
  );
  if (failures.length) throw new Error(failures[0]);
  // Actions that bring a thread back into view need the server's copy of it.
  if (['inbox', 'untrash', 'unspam', 'unread'].includes(action)) {
    items.forEach((i) => hidden.delete(hideKey(i)));
    await Promise.all([...groupByAccount(items).keys()].map(syncAccount));
  }
}

export async function act(action: ThreadAction, items: ThreadRef[]): Promise<ActResult> {
  await perform(items, action);
  return { undoId: registerUndo(() => perform(items, INVERSE[action])) };
}

/**
 * Everything unread in one inbox, read: on the server, not just what Glance
 * has listed, so an inbox with thousands unread is cleared in one go too.
 */
export async function markAllRead(accountId: string): Promise<ActResult & { count: number }> {
  const account = await getAccount(accountId);
  const settings = await getSettings();
  const provider = providerFor(account);
  const listed = ((await getKey<Record<string, ThreadSummary[]>>('threads')) ?? {})[accountId] ?? [];
  const unread = listed.filter((t) => t.unread).map((t) => ({ accountId, threadId: t.id }));
  await applyLocally(unread, 'read', settings);
  let ids: string[];
  try {
    ids = await provider.markAllRead(account, specFor(settings.view, account));
  } catch (e) {
    unread.forEach((r) => hidden.delete(hideKey(r)));
    await syncAccount(accountId);
    throw e;
  }
  return {
    count: unread.length,
    undoId: registerUndo(async () => {
      await provider.restoreUnread(account, ids);
      unread.forEach((r) => hidden.delete(hideKey(r)));
      await syncAccount(accountId);
    }),
  };
}

// ---------------------------------------------------------------- snooze

export async function snooze(items: ThreadRef[], until: number): Promise<ActResult> {
  const threads = (await getKey<Record<string, ThreadSummary[]>>('threads')) ?? {};
  const subjectOf = (r: ThreadRef) =>
    (threads[r.accountId] as ThreadSummary[] | undefined)?.find((t) => t.id === r.threadId)?.subject ?? '';
  await updateSnoozes((all) => [
    ...all.filter((s) => !items.some((i) => i.accountId === s.accountId && i.threadId === s.threadId)),
    ...items.map((i) => ({ ...i, until, subject: subjectOf(i) })),
  ]);
  await perform(items, 'archive');
  await scheduleSnoozeAlarm();
  return {
    undoId: registerUndo(async () => {
      await updateSnoozes((all) => all.filter((s) => !items.some((i) => i.accountId === s.accountId && i.threadId === s.threadId)));
      await perform(items, 'inbox');
      await scheduleSnoozeAlarm();
    }),
  };
}

/**
 * Gmail's own snooze isn't in its API, so Glance keeps snoozes itself: the
 * thread is archived now and put back in the inbox, unread, when it's due.
 * That happens while the browser is running; anything that came due while
 * it was closed returns the next time it starts.
 */
export async function processSnoozes() {
  const now = Date.now();
  const all = (await getKey<Snooze[]>('snoozes')) ?? [];
  const due = all.filter((s) => s.until <= now);
  if (!due.length) return scheduleSnoozeAlarm();
  await updateSnoozes((s) => s.filter((x) => x.until > now));
  for (const [accountId, threadIds] of groupByAccount(due)) {
    try {
      const account = await getAccount(accountId);
      await providerFor(account).modify(account, threadIds, 'inbox');
      await providerFor(account).modify(account, threadIds, 'unread');
      await syncAccount(accountId);
      const settings = await getSettings();
      if (settings.notifications && account.notify && !inQuietHours(settings)) {
        for (const s of due.filter((d) => d.accountId === accountId)) {
          chrome.notifications.create(`t|${accountId}|${s.threadId}`, {
            type: 'basic',
            iconUrl: notificationIcon(),
            title: 'Back from snooze',
            message: s.subject || '(no subject)',
            contextMessage: account.email,
            buttons: THREAD_BUTTONS,
            priority: 0,
          });
        }
      }
    } catch (e) {
      console.warn('[glance] could not unsnooze', accountId, e);
      // Put them back so the next pass tries again.
      await updateSnoozes((s) => [...s, ...due.filter((d) => d.accountId === accountId).map((d) => ({ ...d, until: now + 60_000 }))]);
    }
  }
  await scheduleSnoozeAlarm();
}

async function scheduleSnoozeAlarm() {
  const all = (await getKey<Snooze[]>('snoozes')) ?? [];
  await chrome.alarms.clear('snooze');
  if (!all.length) return;
  const when = Math.max(Date.now() + 1000, Math.min(...all.map((s) => s.until)));
  await chrome.alarms.create('snooze', { when });
}

// ---------------------------------------------------------------- sending

const pendingSends = new Map<string, ReturnType<typeof setTimeout>>();

export async function send(draft: Draft): Promise<SendResult> {
  const account = await getAccount(draft.accountId);
  const settings = await getSettings();
  const delayMs = Math.max(0, settings.undoSendSeconds) * 1000;
  const sendId = crypto.randomUUID();
  const go = async () => {
    pendingSends.delete(sendId);
    try {
      await providerFor(account).send(account, draft);
      if (draft.threadId) setTimeout(() => syncAccount(account.id), 1500);
    } catch (e) {
      // Keep what they wrote: the composer restores it from here.
      const key = `draft:${draft.accountId}:${draft.threadId ?? 'new'}`;
      await chrome.storage.local.set({ [key]: { ...draft, failed: e instanceof Error ? e.message : String(e) } });
      chrome.notifications.create(`f|${sendId}`, {
        type: 'basic',
        iconUrl: notificationIcon(),
        title: 'Message not sent',
        message: `${draft.subject || '(no subject)'}: ${e instanceof Error ? e.message : e}`,
        contextMessage: 'Your draft is saved in Glance.',
        priority: 2,
      });
    }
  };
  if (delayMs === 0) await go();
  else pendingSends.set(sendId, setTimeout(go, delayMs));
  return { sendId, delayMs };
}

export function cancelSend(sendId: string) {
  const timer = pendingSends.get(sendId);
  if (!timer) throw new Error('Already sent.');
  clearTimeout(timer);
  pendingSends.delete(sendId);
}

// ---------------------------------------------------------------- search & reading

export async function search(query: string): Promise<ThreadSummary[]> {
  const accounts = (await getAccounts()).filter((a) => a.status !== 'needs-auth');
  const results = await Promise.all(
    accounts.map((a) =>
      providerFor(a)
        .search(a, query)
        .catch((e) => {
          console.warn('[glance] search failed for', a.id, e);
          return [] as ThreadSummary[];
        }),
    ),
  );
  return results.flat().sort((a, b) => b.date - a.date);
}

export async function getThread(accountId: string, threadId: string) {
  const account = await getAccount(accountId);
  return providerFor(account).getThread(account, threadId);
}

export async function getAttachment(accountId: string, messageId: string, attachmentId: string) {
  if (attachmentId.startsWith('data:')) return attachmentId.split(',')[1];
  const account = await getAccount(accountId);
  return providerFor(account).getAttachment(account, messageId, attachmentId);
}

// ---------------------------------------------------------------- notifications

/** The buttons on a notification about one conversation, in onNotificationButton's order. */
const THREAD_BUTTONS = [{ title: 'Mark as read' }, { title: 'Archive' }];

/** The conversations behind a summary notification, so its button can act on all of them. */
const summaryKey = (id: string) => `notif:${id}`;

async function notifyArrivals(account: Account, arrivals: ThreadSummary[], settings: Settings) {
  if (!settings.notifications || !account.notify || inQuietHours(settings)) return;
  const worth = settings.vipOnly ? arrivals.filter((t) => isVip(settings, t.from.email)) : arrivals;
  if (!worth.length) return;

  if (worth.length > 3) {
    // A plain notification rather than type "list": the Mac shows only the
    // first item of a list, and Quo's notifications are the Mac's own.
    const names = [...new Set(worth.map((t) => t.from.name || t.from.email))];
    const id = `s|${account.id}|${Date.now()}`;
    await chrome.storage.session?.set({ [summaryKey(id)]: worth.map((t) => t.id) }).catch(() => {});
    chrome.notifications.create(id, {
      type: 'basic',
      iconUrl: notificationIcon(),
      title: `${worth.length} new emails`,
      message: names.length > 3 ? `${names.slice(0, 3).join(', ')} and ${names.length - 3} more` : names.join(', '),
      contextMessage: account.email,
      buttons: [{ title: 'Mark all as read' }, { title: 'Archive all' }],
      priority: 0,
    });
    return;
  }
  for (const t of worth) {
    chrome.notifications.create(`t|${account.id}|${t.id}`, {
      type: 'basic',
      iconUrl: notificationIcon(),
      title: t.from.name || t.from.email,
      message: t.subject,
      contextMessage: account.email,
      buttons: THREAD_BUTTONS,
      priority: isVip(settings, t.from.email) ? 2 : 0,
    });
  }
}

export async function onNotificationClicked(id: string) {
  chrome.notifications.clear(id);
  const [kind, accountId, threadId] = id.split('|');
  if (kind === 'r') return reauth(accountId).catch((e) => console.warn('[glance] sign-in from notification failed', e));
  if (kind !== 't' && kind !== 's') return;
  const account = (await getAccounts()).find((a) => a.id === accountId);
  if (!account || account.demo) return;
  await chrome.tabs.create({ url: gmailThreadUrl(account.email, kind === 't' ? threadId : undefined) });
}

export async function onNotificationButton(id: string, index: number) {
  chrome.notifications.clear(id);
  const [kind, accountId, threadId] = id.split('|');
  if (kind === 'r') return reauth(accountId).catch((e) => console.warn('[glance] sign-in from notification failed', e));
  const action = index === 0 ? 'read' : 'archive';
  if (kind === 't') return perform([{ accountId, threadId }], action);
  if (kind !== 's') return;
  const key = summaryKey(id);
  const stored = (await chrome.storage.session?.get(key).catch(() => ({}))) as Record<string, string[]> | undefined;
  const ids = stored?.[key] ?? [];
  await chrome.storage.session?.remove(key).catch(() => {});
  if (ids.length) await perform(ids.map((threadId) => ({ accountId, threadId })), action);
}

// ---------------------------------------------------------------- badge

export async function updateBadge() {
  const { accounts, threads } = await loadState();
  const counts = accounts.map((a) => ({ a, n: (threads[a.id] ?? []).filter((t) => t.unread).length }));
  const total = counts.reduce((s, c) => s + c.n, 0);
  const trouble = accounts.some((a) => a.status === 'needs-auth');
  const text = total === 0 ? (trouble ? '!' : '') : total > 99 ? '99+' : String(total);
  await chrome.action.setBadgeText({ text });
  // Red while an account needs signing in again: the one thing worth colour.
  await chrome.action.setBadgeBackgroundColor({ color: trouble ? '#d93025' : '#0a0a0a' });
  chrome.action.setBadgeTextColor?.({ color: '#ffffff' });
  const lines = counts.map(({ a, n }) => `${a.email}: ${a.status === 'needs-auth' ? 'needs reconnecting' : `${n} unread`}`);
  await chrome.action.setTitle({ title: ['Glance', ...lines].join('\n') });
}

// ---------------------------------------------------------------- settings & alarms

/**
 * Points the toolbar button at what was chosen last. In the side panel's
 * case the popup is taken off the button and the browser opens the panel
 * instead, and closes it on the next press.
 */
/**
 * Light or dark: the eye is drawn in near-black for a light toolbar and in
 * light grey for a dark one. The browser keeps one manifest icon, so Glance
 * swaps it itself whenever a page of its own sees the appearance change: the
 * hidden offscreen page while the browser runs, and the popup, panel and
 * settings whenever they open (for browsers without offscreen pages).
 */
let darkScheme = false;
let schemeSeen = false;
const SCHEME_KEY = 'darkScheme';

const iconPaths = (dark: boolean) =>
  Object.fromEntries([16, 32, 48, 128].map((s) => [s, `/icon/${dark ? 'dark/' : ''}${s}.png`]));

export const notificationIcon = () => chrome.runtime.getURL(`/icon/${darkScheme ? 'dark/' : ''}128.png`);

/** With no value, puts back the last one seen (the worker forgets it when it sleeps). */
export async function applyScheme(dark?: boolean) {
  if (dark === undefined) {
    const stored = (await chrome.storage.local.get(SCHEME_KEY))[SCHEME_KEY];
    if (schemeSeen || typeof stored !== 'boolean') return;
    dark = stored;
  } else {
    schemeSeen = true;
    await chrome.storage.local.set({ [SCHEME_KEY]: dark });
  }
  darkScheme = dark;
  try {
    await chrome.action?.setIcon?.({ path: iconPaths(dark) });
  } catch {
    // A browser that can't set the icon keeps the light one.
  }
}

/** Opens the hidden page that follows the appearance, once. */
export async function watchScheme() {
  const off = chrome.offscreen;
  if (!off?.createDocument) return;
  try {
    if (await off.hasDocument?.()) return;
    await off.createDocument({
      url: 'offscreen.html',
      reasons: [chrome.offscreen.Reason.MATCH_MEDIA],
      justification: 'Match the toolbar icon to the light or dark appearance.',
    });
  } catch {
    // Already open, or not supported: the popup and panel still report it.
  }
}

export async function applySurface(surface?: Settings['surface']) {
  surface ??= (await getSettings()).surface;
  const panel = surface === 'panel';
  // Each on its own: a browser missing either API still gets the other.
  await Promise.allSettled([
    (async () => chrome.action?.setPopup?.({ popup: panel ? '' : 'popup.html' }))(),
    (async () => chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: panel }))(),
  ]);
}

export async function updateSettings(patch: Partial<Settings>) {
  const before = await getSettings();
  const after = withDefaults({ ...before, ...patch });
  await chrome.storage.local.set({ settings: after });
  if (after.surface !== before.surface) await applySurface(after.surface);
  if (after.pollMinutes !== before.pollMinutes) await schedulePolling();
  if (after.view !== before.view) await syncAll();
}

export async function schedulePolling() {
  const { pollMinutes } = await getSettings();
  await chrome.alarms.create('poll', { periodInMinutes: Math.max(0.5, pollMinutes), delayInMinutes: 0.1 });
}

/**
 * Makes sure the mail check is scheduled. Runs every time the worker starts:
 * a browser may restart the worker without an install or startup event (Quo
 * does), and without this nothing would check for mail until the popup opens.
 */
export async function ensurePolling() {
  const { pollMinutes } = await getSettings();
  const period = Math.max(0.5, pollMinutes);
  const existing = await chrome.alarms.get('poll').catch(() => undefined);
  if (!existing || existing.periodInMinutes !== period) {
    await chrome.alarms.create('poll', { periodInMinutes: period, delayInMinutes: 0.1 });
  }
}

/** Shows a notification on demand, so a person can see whether they reach them at all. */
export async function testNotification(): Promise<{ level: string }> {
  // Some browsers never answer this (Quo returns a promise and ignores the callback); give up after a second.
  const level = await Promise.race([
    new Promise<string>((resolve) => {
      try {
        const p = chrome.notifications.getPermissionLevel((l) => resolve(l)) as unknown;
        if (p && typeof (p as Promise<string>).then === 'function') (p as Promise<string>).then(resolve, () => resolve('unknown'));
      } catch {
        resolve('unknown');
      }
    }),
    new Promise<string>((resolve) => setTimeout(() => resolve('unknown'), 1000)),
  ]);
  const accounts = await getAccounts();
  const threads = (await getKey<Record<string, ThreadSummary[]>>('threads')) ?? {};
  const latest = accounts.flatMap((a) => threads[a.id] ?? []).filter((t) => t.unread).sort((a, b) => b.date - a.date)[0];
  await chrome.notifications.create(`test|${Date.now()}`, {
    type: 'basic',
    iconUrl: notificationIcon(),
    title: latest ? latest.from.name || latest.from.email : 'Glance',
    message: latest ? latest.subject : 'Notifications are working. New mail will show up like this.',
    contextMessage: 'Test notification from Glance',
    priority: 0,
  });
  return { level };
}
