import {
  Archive,
  CheckCheck,
  CircleAlert,
  Clock,
  Command as CommandIcon,
  ExternalLink,
  Inbox,
  Mail,
  MailOpen,
  Moon,
  PanelRight,
  Plus,
  RefreshCw,
  Reply,
  ReplyAll,
  ScrollText,
  Search,
  Settings as SettingsIcon,
  ShieldAlert,
  SquarePen,
  Star,
  Sun,
  Trash2,
  Type,
  Undo2,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { clearDraft, Composer, loadDraft } from './Composer';
import { MOD, stepScale, typingIn, useChecking, useKeyboardFocus, useLatest, useMail, useNow, useSpin, useTheme, useWidth } from './hooks';
import { ActionMenu, Palette, SnoozeMenu, type Command, type MenuAnchor } from './Palette';
import { Reader } from './Reader';
import { blankDraft, replyDraft } from './reply';
import { describeSnooze } from './snooze';
import { LinkContext, type Mailto } from './links';
import { GroupHead, ThreadRow } from './ThreadRow';
import { Tips } from './Tips';
import { ToastProvider, useToasts } from './Toasts';
import { gmailThreadUrl } from '../shared/format';
import { request } from '../shared/store';
import type {
  Account,
  ActResult,
  Draft,
  MailState,
  SendResult,
  ThreadAction,
  ThreadDetail,
  ThreadRef,
  ThreadSummary,
} from '../shared/types';

export type Layout = 'popup' | 'panel';
type Nav = 'forward' | 'back' | 'next' | 'prev';

const keyOf = (t: { accountId: string; id: string }) => `${t.accountId}|${t.id}`;
const refOf = (t: ThreadSummary): ThreadRef => ({ accountId: t.accountId, threadId: t.id });

const DONE: Record<ThreadAction, string> = {
  read: 'Marked as read',
  unread: 'Marked as unread',
  archive: 'Archived',
  inbox: 'Moved to Inbox',
  trash: 'Moved to Trash',
  untrash: 'Restored',
  star: 'Starred',
  unstar: 'Unstarred',
  spam: 'Reported as spam',
  unspam: 'Not spam',
};

/** Actions that take a thread out of view, after which the reader moves on. */
const LEAVES: ThreadAction[] = ['archive', 'trash', 'spam'];

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

type ViewTransition = { finished: Promise<void>; ready: Promise<void>; updateCallbackDone: Promise<void> };
type WithTransitions = Document & { startViewTransition?: (cb: () => void) => ViewTransition };

/**
 * Runs a state change inside a view transition, so the browser animates
 * between the before and after. Without the API (or with reduced motion)
 * the change just happens.
 */
function transition(dir: Nav, update: () => void): Promise<void> {
  const doc = document as WithTransitions;
  if (!doc.startViewTransition || reducedMotion()) {
    update();
    return Promise.resolve();
  }
  const root = document.documentElement;
  root.dataset.nav = dir;
  const t = doc.startViewTransition(() => flushSync(update));
  // A newer transition skips this one (fast j/k presses); that's expected, not an error.
  t.ready.catch(() => {});
  t.updateCallbackDone.catch(() => {});
  return t.finished.catch(() => {}).finally(() => {
    if (root.dataset.nav === dir) delete root.dataset.nav;
  });
}

/** Short, unique labels for each inbox: the first letter of its address, more if two collide. */
function monogramsFor(accounts: Account[]): Map<string, string> {
  const locals = accounts.map((a) => a.email.split('@')[0].replace(/[^a-z0-9]/gi, '') || a.email);
  const out = new Map<string, string>();
  accounts.forEach((a, i) => {
    let label = '';
    for (let n = 1; n <= 2; n++) {
      const p = locals[i].slice(0, n).toLowerCase();
      if (!locals.some((l, j) => j !== i && l.slice(0, n).toLowerCase() === p)) {
        label = p;
        break;
      }
    }
    out.set(a.id, (label || String(i + 1)).toUpperCase());
  });
  return out;
}

interface Item {
  t: ThreadSummary;
  leaving: boolean;
  entering: boolean;
}

interface Ghost {
  t: ThreadSummary;
  /** The row it sat after, so it keeps its place while it folds away. */
  after: string | null;
  /** When its fold has played and it can go. */
  until: number;
}

/**
 * The list as drawn: the live threads, plus any that just left, kept in
 * their old place for the length of their fold-away animation. A change of
 * scope (another inbox, a search) swaps the list without animating.
 *
 * What left is worked out while rendering, not in an effect afterwards, so
 * a leaving row never drops out of the page for a render and comes back as
 * a new element: it stays the same row from start to finish.
 */
function useAnimatedList(list: ThreadSummary[], scope: string): Item[] {
  const [seen, setSeen] = useState<{ scope: string; list: ThreadSummary[]; before: ThreadSummary[] | null; ghosts: Ghost[] }>(
    () => ({ scope, list, before: null, ghosts: [] }),
  );

  let state = seen;
  if (seen.list !== list || seen.scope !== scope) {
    let ghosts: Ghost[] = [];
    let before: ThreadSummary[] | null = null;
    if (seen.scope === scope) {
      before = seen.list;
      const now = new Set(list.map(keyOf));
      ghosts = seen.ghosts.filter((g) => !now.has(keyOf(g.t)));
      const gone = seen.list.filter((t) => !now.has(keyOf(t)));
      if (gone.length && gone.length <= 12 && !reducedMotion()) {
        const until = Date.now() + 340;
        ghosts = [
          ...ghosts,
          ...gone.map((t) => {
            const i = seen.list.indexOf(t);
            return { t, after: i > 0 ? keyOf(seen.list[i - 1]) : null, until };
          }),
        ];
      }
    }
    state = { scope, list, before, ghosts };
    setSeen(state);
  }

  // Each ghost goes once its fold has played.
  useEffect(() => {
    if (!state.ghosts.length) return;
    const wait = Math.max(0, Math.min(...state.ghosts.map((g) => g.until)) - Date.now());
    const timer = setTimeout(
      () => setSeen((s) => ({ ...s, ghosts: s.ghosts.filter((g) => g.until > Date.now()) })),
      wait,
    );
    return () => clearTimeout(timer);
  }, [state.ghosts]);

  const { before, ghosts } = state;
  return useMemo(() => {
    const known = before ? new Set(before.map(keyOf)) : null;
    const live = new Set(list.map(keyOf));
    const pending = ghosts.filter((g) => !live.has(keyOf(g.t)));
    const after = new Map<string | null, ThreadSummary[]>();
    for (const g of pending) after.set(g.after, [...(after.get(g.after) ?? []), g.t]);
    const out: Item[] = [];
    const placed = new Set<string>();
    const place = (anchor: string | null) => {
      for (const t of after.get(anchor) ?? []) {
        if (placed.has(keyOf(t))) continue;
        placed.add(keyOf(t));
        out.push({ t, leaving: true, entering: false });
        place(keyOf(t));
      }
    };
    place(null);
    for (const t of list) {
      out.push({ t, leaving: false, entering: !!known && !known.has(keyOf(t)) });
      place(keyOf(t));
    }
    // Ghosts whose anchor is gone too: put them at the end rather than drop them mid-animation.
    for (const g of pending) if (!placed.has(keyOf(g.t))) out.push({ t: g.t, leaving: true, entering: false });
    return out;
  }, [list, ghosts, before]);
}

export function App({ layout }: { layout: Layout }) {
  const state = useMail();
  useTheme(state?.settings);
  if (!state) return <div className="app" />;
  return (
    <ToastProvider>
      <MailApp state={state} layout={layout} />
      <Tips />
    </ToastProvider>
  );
}

function ago(ms: number, now: number) {
  const s = Math.round((now - ms) / 1000);
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return `${h} hr ago`;
}

function MailApp({ state, layout }: { state: MailState; layout: Layout }) {
  const { push } = useToasts();
  const width = useWidth();
  const now = useNow();
  const split = layout === 'panel' && width >= 680;
  const { accounts, threads, settings } = state;
  const byId = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);
  const monograms = useMemo(() => monogramsFor(accounts), [accounts]);
  const checking = useChecking();
  const keyboard = useKeyboardFocus();
  const [asked, setAsked] = useState(false);
  const spin = useSpin(checking || asked || accounts.some((a) => a.status === 'syncing'));

  useEffect(() => {
    document.documentElement.dataset.split = String(split);
  }, [split]);

  useEffect(() => {
    document.documentElement.style.setProperty('--text-scale', String(settings.textScale ?? 1));
  }, [settings.textScale]);

  /** Bigger or smaller mail text (+1 / -1), or back to as designed (0). */
  const scaleText = (dir: 1 | -1 | 0) => {
    const textScale = dir === 0 ? 1 : stepScale(settings.textScale ?? 1, dir);
    request({ type: 'updateSettings', patch: { textScale } }).catch(() => {});
    push({ text: `Text size ${Math.round(textScale * 100)}%`, ms: 1400 });
  };

  const [filter, setFilterState] = useState<string>(() => {
    try {
      return localStorage.getItem('glance.filter') ?? 'all';
    } catch {
      return 'all';
    }
  });
  const setFilter = (f: string) => {
    setFilterState(f);
    try {
      localStorage.setItem('glance.filter', f);
    } catch {
      /* private mode */
    }
  };
  const activeFilter = filter === 'all' || byId.has(filter) ? filter : 'all';

  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ThreadSummary[] | null>(null);
  const [resultsFor, setResultsFor] = useState('');
  const [searching, setSearching] = useState(false);
  const searchInput = useRef<HTMLInputElement>(null);

  const [cursorKey, setCursorKey] = useState<string | null>(null);
  const lastIndex = useRef(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<ThreadSummary | null>(null);
  const [detail, setDetail] = useState<ThreadDetail | null>(null);
  const [detailError, setDetailError] = useState<string>();
  /** The open thread stays in the list while it's being read, even once marked read. */
  const [retained, setRetained] = useState<ThreadSummary | null>(null);
  /** Which row's subject travels into the reader's title, and whether it does right now. */
  const [morphKey, setMorphKey] = useState<string | null>(null);
  const [morphOn, setMorphOn] = useState(true);
  const [composer, setComposer] = useState<(Draft & { failed?: string }) | null>(null);
  const [palette, setPalette] = useState(false);
  const [snoozing, setSnoozing] = useState<ThreadRef[] | null>(null);
  /** The inbox whose menu is open (from its heading, its tab or the palette). */
  const [menu, setMenu] = useState<{ account: Account; anchor?: MenuAnchor } | null>(null);
  // The menu shows the account as it is now, so Primary only's tick follows a change.
  const inboxMenu = menu ? (byId.get(menu.account.id) ?? null) : null;
  const setInboxMenu = (account: Account | null, anchor?: MenuAnchor) => setMenu(account ? { account, anchor } : null);
  const lastUndo = useRef<(() => void) | null>(null);
  const windowId = useRef<number | undefined>(undefined);
  const openSeq = useRef(0);

  // ------------------------------------------------------------ data

  const visible = useMemo(() => {
    let list: ThreadSummary[];
    if (results) list = results.filter((t) => activeFilter === 'all' || t.accountId === activeFilter);
    else {
      list = activeFilter === 'all' ? accounts.flatMap((a) => threads[a.id] ?? []) : (threads[activeFilter] ?? []);
      if (
        retained &&
        !list.some((t) => keyOf(t) === keyOf(retained)) &&
        (activeFilter === 'all' || retained.accountId === activeFilter)
      ) {
        list = [...list, retained];
      }
      const q = query.trim().toLowerCase();
      if (q) {
        list = list.filter((t) => `${t.subject} ${t.from.name} ${t.from.email} ${t.snippet}`.toLowerCase().includes(q));
      }
    }
    // All inboxes: one group per inbox, in tab order (1, 2, 3…), newest first within each.
    const order = new Map(accounts.map((a, i) => [a.id, i]));
    const grouped = activeFilter === 'all' && accounts.length > 1;
    return [...list].sort(
      (a, b) => (grouped ? (order.get(a.accountId) ?? 0) - (order.get(b.accountId) ?? 0) : 0) || b.date - a.date,
    );
  }, [results, accounts, threads, activeFilter, retained, query]);

  const drawn = useAnimatedList(visible, `${activeFilter}|${resultsFor}|${results ? 's' : 'i'}|${settings.view}`);

  const cursorIndex = useMemo(() => {
    const i = cursorKey ? visible.findIndex((t) => keyOf(t) === cursorKey) : -1;
    if (i >= 0) return i;
    return visible.length ? Math.min(lastIndex.current, visible.length - 1) : -1;
  }, [visible, cursorKey]);
  lastIndex.current = Math.max(0, cursorIndex);
  const cursor = cursorIndex >= 0 ? visible[cursorIndex] : undefined;

  const unreadIn = (id: string) => (threads[id] ?? []).filter((t) => t.unread).length;
  const totalUnread = accounts.reduce((n, a) => n + unreadIn(a.id), 0);
  const troubled = accounts.filter((a) => a.status === 'needs-auth');

  useEffect(() => {
    chrome.windows?.getCurrent?.().then((w) => (windowId.current = w.id)).catch(() => {});
    // Check for mail on open, unless that just happened.
    const fresh = accounts.length && accounts.every((a) => a.lastSync && Date.now() - a.lastSync < 20_000);
    if (!fresh && accounts.length) request({ type: 'refresh' }).catch(() => {});
  }, []);

  // ------------------------------------------------------------ actions

  const targets = (): ThreadRef[] => {
    if (selected.size) return visible.filter((t) => selected.has(keyOf(t))).map(refOf);
    if (open) return [refOf(open)];
    return cursor ? [refOf(cursor)] : [];
  };

  /** R: read if any of them is unread, unread if they're all read. Read from the live store, not the copy the reader opened with. */
  const toggleRead = () => {
    const refs = targets();
    if (!refs.length) return;
    const live = (r: ThreadRef) =>
      (threads[r.accountId] ?? []).find((t) => t.id === r.threadId) ?? results?.find((t) => t.accountId === r.accountId && t.id === r.threadId);
    act(refs.some((r) => live(r)?.unread) ? 'read' : 'unread', refs);
  };

  const undoable = (undoId: string | undefined, text: string) => {
    if (!undoId) return push({ text });
    const run = () =>
      request({ type: 'undo', undoId })
        .then(() => push({ text: 'Undone', ms: 1800 }))
        .catch((e) => push({ text: e.message, error: true }));
    lastUndo.current = run;
    push({ text, action: { label: 'Undo', key: 'Z', run } });
  };

  const closeReader = useCallback(
    (animate = true) => {
      openSeq.current++;
      const shut = () => {
        setOpen(null);
        setDetail(null);
        setDetailError(undefined);
        setComposer(null);
      };
      // The row stays until the transition lands back on it, then folds away if it was read.
      const done = animate ? transition('back', shut) : (shut(), Promise.resolve());
      done.then(() => setRetained(null));
    },
    [],
  );

  const neighbor = (t: ThreadSummary, dir: 1 | -1 = 1): ThreadSummary | undefined => {
    const i = visible.findIndex((x) => keyOf(x) === keyOf(t));
    if (i < 0) return visible[Math.min(lastIndex.current, visible.length - 1)];
    return visible[i + dir] ?? (dir === 1 ? visible[i - 1] : undefined);
  };

  const openThread = async (t: ThreadSummary, dir: Nav = 'forward') => {
    const seq = ++openSeq.current;
    const ref = refOf(t);
    const show = () => {
      setOpen(t);
      setCursorKey(keyOf(t));
      // The thread may already have loaded (the transition runs this a frame later): keep it if so.
      setDetail((d) => (d && d.id === t.id && d.accountId === t.accountId ? d : null));
      setDetailError(undefined);
      setComposer(null);
      setSelected(new Set());
      setRetained({ ...t, unread: false });
      setMorphKey(keyOf(t));
    };

    if (dir === 'forward' && !split) {
      // Name the row's subject before the "before" picture is taken.
      flushSync(() => {
        setMorphKey(keyOf(t));
        setMorphOn(true);
      });
      transition('forward', show);
    } else if (dir === 'forward') {
      transition(open ? 'next' : 'forward', show);
    } else {
      flushSync(() => setMorphOn(false));
      transition(dir, show).then(() => seq === openSeq.current && setMorphOn(true));
    }

    loadDraft(ref).then((d) => seq === openSeq.current && d && setComposer(d));
    try {
      const d = await request<ThreadDetail>({ type: 'getThread', ...ref });
      if (seq === openSeq.current) setDetail(d);
    } catch (e) {
      if (seq === openSeq.current) setDetailError(e instanceof Error ? e.message : String(e));
      return;
    }
    if (t.unread && settings.markReadOnOpen) request({ type: 'act', action: 'read', items: [ref] }).catch(() => {});
  };

  const act = async (action: ThreadAction, refs = targets()) => {
    if (!refs.length) return;
    const keys = new Set(refs.map((r) => `${r.accountId}|${r.threadId}`));
    const leavingOpen = open && keys.has(keyOf(open)) && LEAVES.includes(action);
    const next = leavingOpen ? neighbor(open!) : undefined;

    if (LEAVES.includes(action)) {
      setSelected(new Set());
      if (retained && keys.has(keyOf(retained)) && !leavingOpen) setRetained(null);
      if (results) setResults((r) => r && r.filter((t) => !keys.has(keyOf(t))));
    } else if (results && ['star', 'unstar', 'read', 'unread'].includes(action)) {
      setResults(
        (r) =>
          r &&
          r.map((t) =>
            keys.has(keyOf(t))
              ? {
                  ...t,
                  starred: action === 'star' ? true : action === 'unstar' ? false : t.starred,
                  unread: action === 'unread' ? true : action === 'read' ? false : t.unread,
                }
              : t,
          ),
      );
    }
    if (open && keys.has(keyOf(open))) {
      if (action === 'star' || action === 'unstar') setDetail((d) => d && { ...d, starred: action === 'star' });
    }
    if (leavingOpen) {
      if (next && keyOf(next) !== keyOf(open!)) openThread(next, 'next');
      else {
        setRetained(null);
        closeReader();
      }
    } else if (action === 'unread' && open && keys.has(keyOf(open))) {
      setRetained(null);
      closeReader();
    }

    try {
      const r = await request<ActResult>({ type: 'act', action, items: refs });
      undoable(r.undoId, refs.length > 1 ? `${DONE[action]} · ${refs.length} conversations` : DONE[action]);
    } catch (e) {
      push({ text: e instanceof Error ? e.message : String(e), error: true });
    }
  };

  /** Everything unread in one inbox, read, with an undo. */
  const markAllRead = async (a: Account) => {
    if (open?.accountId === a.id) closeReader();
    setSelected(new Set());
    try {
      const r = await request<ActResult & { count: number }>({ type: 'markAllRead', accountId: a.id });
      undoable(r.undoId, `Marked all read in ${nameOf(a)}`);
    } catch (e) {
      push({ text: e instanceof Error ? e.message : String(e), error: true });
    }
  };

  const togglePrimary = (a: Account) => {
    const primaryOnly = !a.primaryOnly;
    request({ type: 'updateAccount', accountId: a.id, patch: { primaryOnly } })
      .then(() => push({ text: primaryOnly ? `${nameOf(a)}: Primary only` : `${nameOf(a)}: every unread email`, ms: 2200 }))
      .catch((e) => push({ text: e.message, error: true }));
  };

  const snooze = async (refs: ThreadRef[], until: number) => {
    setSnoozing(null);
    const keys = new Set(refs.map((r) => `${r.accountId}|${r.threadId}`));
    if (open && keys.has(keyOf(open))) {
      const next = neighbor(open);
      if (next && keyOf(next) !== keyOf(open)) openThread(next, 'next');
      else {
        setRetained(null);
        closeReader();
      }
    } else if (retained && keys.has(keyOf(retained))) setRetained(null);
    setSelected(new Set());
    if (results) setResults((r) => r && r.filter((t) => !keys.has(keyOf(t))));
    try {
      const r = await request<ActResult>({ type: 'snooze', items: refs, until });
      undoable(r.undoId, `Snoozed until ${describeSnooze(until)}`);
    } catch (e) {
      push({ text: e instanceof Error ? e.message : String(e), error: true });
    }
  };

  const toggleSelect = (t: ThreadSummary) =>
    setSelected((s) => {
      const n = new Set(s);
      const k = keyOf(t);
      n.has(k) ? n.delete(k) : n.add(k);
      return n;
    });

  const runSearch = async (q: string) => {
    setSearching(true);
    setSearchOpen(false);
    setQuery('');
    if (open) closeReader(false);
    try {
      const found = await request<ThreadSummary[]>({ type: 'search', query: q });
      setResultsFor(q);
      setResults(found);
      setCursorKey(null);
      lastIndex.current = 0;
    } catch (e) {
      push({ text: e instanceof Error ? e.message : String(e), error: true });
    } finally {
      setSearching(false);
    }
  };

  const clearResults = () => {
    setResults(null);
    setResultsFor('');
  };

  const toggleInboxTabs = () =>
    request({ type: 'updateSettings', patch: { inboxTabs: !settings.inboxTabs } }).catch((e: Error) =>
      push({ text: e.message, error: true }),
    );

  const toggleFullAddresses = () =>
    request({ type: 'updateSettings', patch: { fullAddresses: !settings.fullAddresses } }).catch((e: Error) =>
      push({ text: e.message, error: true }),
    );

  const toggleFullPreviews = () =>
    request({ type: 'updateSettings', patch: { fullPreviews: !settings.fullPreviews } }).catch((e: Error) =>
      push({ text: e.message, error: true }),
    );

  // ------------------------------------------------------------ compose & reply

  const openAccount: Account | undefined = open ? byId.get(open.accountId) : undefined;

  const startReply = async (all: boolean) => {
    if (!detail || !openAccount) return;
    const saved = await loadDraft({ accountId: openAccount.id, threadId: detail.id });
    setComposer(saved ?? replyDraft(openAccount, detail, all));
  };

  const compose = async () => {
    const from =
      (activeFilter !== 'all' && byId.get(activeFilter)) || accounts.find((a) => a.status !== 'needs-auth') || accounts[0];
    if (!from) return;
    const saved = await loadDraft({ accountId: from.id });
    setComposer(saved ?? blankDraft(from.id));
  };

  /** Re-reads the open thread, so a reply just sent shows up in it. */
  const reloadSoon = (threadId: string | undefined, ms: number) => {
    if (!threadId || !open) return;
    const seq = openSeq.current;
    const accountId = open.accountId;
    setTimeout(() => {
      if (seq !== openSeq.current) return;
      request<ThreadDetail>({ type: 'getThread', accountId, threadId })
        .then((d) => seq === openSeq.current && setDetail(d))
        .catch(() => {});
    }, ms);
  };

  /** A mailto link in an email opens a new message from the inbox being read. */
  const composeTo = (m: Mailto) => {
    const from = openAccount ?? (activeFilter !== 'all' ? byId.get(activeFilter) : undefined) ?? accounts[0];
    if (!from) return;
    setComposer({ ...blankDraft(from.id), to: m.to, cc: m.cc, bcc: m.bcc, subject: m.subject, body: m.body });
  };
  const links = useMemo(() => ({ onMailto: composeTo }), [openAccount?.id, activeFilter, accounts]);

  const send = async (d: Draft) => {
    const res = await request<SendResult>({ type: 'send', draft: d });
    await clearDraft(d);
    setComposer(null);
    reloadSoon(d.threadId, res.delayMs + 1200);
    if (res.delayMs <= 0) return void push({ text: 'Sent', ms: 2000 });
    let cancelled = false;
    setTimeout(() => !cancelled && push({ text: 'Sent', ms: 1600 }), res.delayMs);
    const run = async () => {
      try {
        await request({ type: 'cancelSend', sendId: res.sendId });
        cancelled = true;
        await chrome.storage.local.set({ [`draft:${d.accountId}:${d.threadId ?? 'new'}`]: d });
        setComposer(d);
        push({ text: 'Sending cancelled', ms: 2000 });
      } catch (e) {
        push({ text: e instanceof Error ? e.message : String(e), error: true });
      }
    };
    lastUndo.current = run;
    push({ text: 'Sending…', ms: res.delayMs, countdown: true, action: { label: 'Undo', key: 'Z', run } });
  };

  const discard = async () => {
    if (!composer) return;
    await clearDraft(composer);
    setComposer(null);
    push({ text: 'Draft discarded', ms: 2000 });
  };

  // ------------------------------------------------------------ app

  const openInGmail = (t: ThreadSummary | null | undefined) => {
    const a = t && byId.get(t.accountId);
    if (!a) return;
    if (a.demo) return void push({ text: 'Sample mail has no Gmail copy to open.' });
    chrome.tabs.create({ url: gmailThreadUrl(a.email, t!.id) });
  };

  const openPanel = () => {
    if (windowId.current === undefined) return;
    chrome.sidePanel
      .open({ windowId: windowId.current })
      .then(() => window.close())
      .catch((e: Error) => push({ text: e.message, error: true }));
  };

  const openSettings = () => chrome.runtime.openOptionsPage();

  const addAccount = () =>
    request({ type: 'addAccount' }).catch((e: Error) =>
      push({
        text: e.message,
        error: true,
        ms: 9000,
        action: /OAuth client/.test(e.message) ? { label: 'Settings', run: openSettings } : undefined,
      }),
    );

  const reconnect = (a: Account) =>
    request({ type: 'reauth', accountId: a.id }).catch((e: Error) => push({ text: e.message, error: true }));

  const refresh = () => {
    setAsked(true);
    return request({ type: 'refresh' })
      .catch((e: Error) => push({ text: e.message, error: true }))
      .finally(() => setAsked(false));
  };

  // ------------------------------------------------------------ commands

  const target = open ?? cursor;
  const commands: Command[] = [];
  if (target) {
    const multi = selected.size > 1 ? ` (${selected.size})` : '';
    commands.push(
      { id: 'archive', group: 'Conversation', label: `Archive${multi}`, icon: Archive, keys: ['E'], run: () => act('archive') },
      { id: 'trash', group: 'Conversation', label: `Delete${multi}`, icon: Trash2, keys: ['#'], run: () => act('trash') },
      { id: 'read', group: 'Conversation', label: `Mark as read${multi}`, icon: MailOpen, keys: ['R'], run: () => act('read') },
      { id: 'unread', group: 'Conversation', label: `Mark as unread${multi}`, icon: Mail, keys: ['R'], run: () => act('unread') },
      {
        id: 'star',
        group: 'Conversation',
        label: (open ? detail?.starred : target.starred) ? 'Remove star' : 'Star',
        icon: Star,
        keys: ['S'],
        run: () => act((open ? detail?.starred : target.starred) ? 'unstar' : 'star'),
      },
      { id: 'snooze', group: 'Conversation', label: `Snooze${multi}…`, icon: Clock, keys: ['H'], run: () => setSnoozing(targets()) },
      { id: 'spam', group: 'Conversation', label: `Report spam${multi}`, icon: ShieldAlert, keys: ['!'], run: () => act('spam') },
    );
    if (open && detail) {
      commands.push(
        { id: 'reply', group: 'Conversation', label: 'Reply', icon: Reply, keys: ['↵'], run: () => startReply(false) },
        { id: 'replyall', group: 'Conversation', label: 'Reply all', icon: ReplyAll, keys: ['A'], run: () => startReply(true) },
      );
    }
    if (!byId.get(target.accountId)?.demo) {
      commands.push({ id: 'gmail', group: 'Conversation', label: 'Open in Gmail', icon: ExternalLink, keys: ['G'], run: () => openInGmail(target) });
    }
  }
  commands.push(
    { id: 'compose', group: 'Mail', label: 'New message', icon: SquarePen, keys: ['C'], run: compose },
    { id: 'search', group: 'Mail', label: 'Search', icon: Search, keys: ['/'], run: () => setSearchOpen(true) },
    { id: 'refresh', group: 'Mail', label: 'Check for new mail', icon: RefreshCw, keys: ['⇧', 'R'], run: refresh },
  );
  if (lastUndo.current) commands.push({ id: 'undo', group: 'Mail', label: 'Undo', icon: Undo2, keys: ['Z'], run: () => lastUndo.current?.() });
  const unreadVisible = visible.filter((t) => t.unread);
  if (unreadVisible.length > 1) {
    commands.push({
      id: 'allread',
      group: 'Mail',
      label: `Mark all ${unreadVisible.length} as read`,
      icon: MailOpen,
      run: () => act('read', unreadVisible.map(refOf)),
    });
  }
  if (accounts.length > 1) {
    commands.push({ id: 'f-all', group: 'Inboxes', label: 'All inboxes', icon: Inbox, keys: ['A'], run: () => setFilter('all') });
    accounts.forEach((a, i) =>
      commands.push({
        id: `f-${a.id}`,
        group: 'Inboxes',
        label: a.email,
        icon: Inbox,
        keys: i < 9 ? [String(i + 1)] : undefined,
        run: () => setFilter(a.id),
      }),
    );
  }
  for (const a of accounts) {
    if (unreadIn(a.id)) {
      commands.push({ id: `allread-${a.id}`, group: 'Inboxes', label: `Mark all read in ${a.email}`, icon: CheckCheck, run: () => markAllRead(a) });
    }
    if (settings.view !== 'unread-primary') {
      commands.push({
        id: `primary-${a.id}`,
        group: 'Inboxes',
        label: a.primaryOnly ? `Show every unread email for ${a.email}` : `Primary only for ${a.email}`,
        icon: Inbox,
        run: () => togglePrimary(a),
      });
    }
  }
  if (accounts.length > 1) {
    commands.push({
      id: 'tabs',
      group: 'View',
      label: settings.inboxTabs ? 'Hide inbox tabs' : 'Show inbox tabs',
      icon: Inbox,
      run: toggleInboxTabs,
    });
  }
  if (accounts.length > 1 && settings.inboxTabs) {
    commands.push({
      id: 'addresses',
      group: 'View',
      label: settings.fullAddresses ? 'Show short names in inbox tabs' : 'Show full addresses in inbox tabs',
      icon: Inbox,
      run: toggleFullAddresses,
    });
  }
  commands.push(
    { id: 'text-up', group: 'View', label: 'Larger text', icon: ZoomIn, keys: [MOD, '+'], run: () => scaleText(1) },
    { id: 'text-down', group: 'View', label: 'Smaller text', icon: ZoomOut, keys: [MOD, '−'], run: () => scaleText(-1) },
  );
  if ((settings.textScale ?? 1) !== 1) {
    commands.push({ id: 'text-reset', group: 'View', label: 'Actual text size', icon: Type, keys: [MOD, '0'], run: () => scaleText(0) });
  }
  commands.push({
    id: 'full',
    group: 'View',
    label: settings.fullPreviews ? 'Show short previews in the list' : 'Show full emails in the list',
    icon: ScrollText,
    keys: ['V'],
    run: toggleFullPreviews,
  });
  for (const [view, label] of [
    ['unread-inbox', 'Show unread in Inbox'],
    ['unread-primary', 'Show unread in Primary only'],
    ['inbox', 'Show everything in Inbox'],
  ] as const) {
    if (settings.view !== view) {
      commands.push({ id: `v-${view}`, group: 'View', label, icon: Inbox, run: () => request({ type: 'updateSettings', patch: { view } }) });
    }
  }
  commands.push(
    {
      id: 'theme',
      group: 'View',
      label: settings.theme === 'dark' ? 'Use light appearance' : 'Use dark appearance',
      icon: settings.theme === 'dark' ? Sun : Moon,
      run: () => request({ type: 'updateSettings', patch: { theme: settings.theme === 'dark' ? 'light' : 'dark' } }),
    },
    { id: 'theme-system', group: 'View', label: 'Match system appearance', icon: Sun, run: () => request({ type: 'updateSettings', patch: { theme: 'system' } }) },
  );
  if (layout === 'popup') commands.push({ id: 'panel', group: 'Glance', label: 'Open in side panel', icon: PanelRight, run: openPanel });
  commands.push(
    { id: 'add', group: 'Glance', label: 'Add a Gmail account', icon: Plus, run: addAccount },
    { id: 'settings', group: 'Glance', label: 'Settings', icon: SettingsIcon, keys: [MOD, ','], run: openSettings },
  );

  // ------------------------------------------------------------ keyboard

  const onKey = (e: KeyboardEvent) => {
    const mod = e.metaKey || e.ctrlKey;
    const k = e.key;
    if (mod && k.toLowerCase() === 'k') {
      e.preventDefault();
      setPalette((p) => !p);
      return;
    }
    if (mod && k === ',') {
      e.preventDefault();
      openSettings();
      return;
    }
    // ⌘+ / ⌘− / ⌘0: mail text size. Taken before the browser zooms the whole page.
    if (mod && !e.altKey && (k === '=' || k === '+' || k === '-' || k === '_' || k === '0')) {
      e.preventDefault();
      scaleText(k === '0' ? 0 : k === '-' || k === '_' ? -1 : 1);
      return;
    }
    if (palette || snoozing || inboxMenu) return;
    if (typingIn(e.target)) {
      if (k === 'Escape' && e.target === searchInput.current) {
        setSearchOpen(false);
        setQuery('');
      } else if (k === 'Enter' && e.target === searchInput.current && query.trim()) {
        runSearch(query.trim());
      } else if ((k === 'ArrowDown' || k === 'ArrowUp') && e.target === searchInput.current) {
        e.preventDefault();
        searchInput.current?.blur();
      }
      return;
    }
    if (composer && !open) return; // the compose sheet owns the keyboard
    if (mod && k.toLowerCase() === 'a' && !open) {
      e.preventDefault();
      setSelected(new Set(visible.map(keyOf)));
      return;
    }
    if (mod || e.altKey) return;

    const handled = () => e.preventDefault();
    const common: Record<string, () => void> = {
      e: () => act('archive'),
      '#': () => act('trash'),
      r: toggleRead,
      I: () => act('read'),
      U: () => act('unread'),
      s: () => {
        const t = open ?? cursor;
        if (t) act((open ? detail?.starred : t.starred) ? 'unstar' : 'star');
      },
      h: () => targets().length && setSnoozing(targets()),
      '!': () => act('spam'),
      g: () => openInGmail(open ?? cursor),
      c: compose,
      z: () => lastUndo.current?.(),
      R: refresh,
      // Plain-key palette for browsers that keep ⌘K for themselves (Quo, Arc).
      '.': () => setPalette(true),
      v: toggleFullPreviews,
    };

    if (open) {
      const reader: Record<string, () => void> = {
        Escape: () => (composer ? setComposer(null) : closeReader()),
        u: () => closeReader(),
        j: () => {
          const n = neighbor(open, 1);
          if (n && keyOf(n) !== keyOf(open)) openThread(n, 'next');
        },
        k: () => {
          const n = neighbor(open, -1);
          if (n) openThread(n, 'prev');
        },
        // ↵ replies: a focused button keeps ↵ for itself.
        Enter: () => {
          if (!(e.target instanceof HTMLElement && e.target.closest('button, a, select'))) startReply(false);
        },
        a: () => startReply(true),
        ...common,
      };
      const fn = reader[k];
      if (fn) {
        handled();
        fn();
      }
      return;
    }

    const move = (d: number) => {
      if (!visible.length) return;
      const i = Math.max(0, Math.min(visible.length - 1, (cursorIndex < 0 ? -1 : cursorIndex) + d));
      setCursorKey(keyOf(visible[i]));
    };
    const list: Record<string, () => void> = {
      j: () => move(1),
      ArrowDown: () => move(1),
      k: () => move(-1),
      ArrowUp: () => move(-1),
      Enter: () => cursor && openThread(cursor),
      o: () => cursor && openThread(cursor),
      x: () => cursor && toggleSelect(cursor),
      '/': () => setSearchOpen(true),
      Escape: () => {
        if (selected.size) setSelected(new Set());
        else if (results) clearResults();
        else if (query) setQuery('');
      },
      ...common,
    };
    // A for all inboxes, 1–9 for each inbox in order. (In the reader, A is reply all.)
    if (accounts.length > 1 && (k === 'a' || /^[1-9]$/.test(k))) {
      handled();
      if (k === 'a') setFilter('all');
      else if (accounts[Number(k) - 1]) setFilter(accounts[Number(k) - 1].id);
      return;
    }
    const fn = list[k];
    if (fn) {
      handled();
      fn();
    }
  };
  const keyRef = useLatest(onKey);
  useEffect(() => {
    const on = (e: KeyboardEvent) => keyRef.current(e);
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, []);

  useEffect(() => {
    if (searchOpen) searchInput.current?.focus();
  }, [searchOpen]);

  // Long addresses overflow the tab bar: keep the chosen inbox in view, and fade
  // whichever edge has more tabs past it.
  const tabsRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const nav = tabsRef.current;
    if (!nav) return;
    nav.querySelector<HTMLElement>('[aria-pressed="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const edges = () => {
      nav.dataset.left = String(nav.scrollLeft > 2);
      nav.dataset.right = String(nav.scrollLeft + nav.clientWidth < nav.scrollWidth - 2);
    };
    edges();
    nav.addEventListener('scroll', edges, { passive: true });
    window.addEventListener('resize', edges);
    return () => {
      nav.removeEventListener('scroll', edges);
      window.removeEventListener('resize', edges);
    };
  }, [activeFilter, settings.fullAddresses, settings.inboxTabs, accounts.length]);

  // ------------------------------------------------------------ render

  if (!accounts.length) {
    return <Welcome onAdd={addAccount} onDemo={() => request({ type: 'addDemo' })} onSettings={openSettings} />;
  }

  const syncingNow = accounts.some((a) => a.status === 'syncing');
  const errored = accounts.find((a) => a.status === 'error');
  const lastSync = Math.min(...accounts.map((a) => a.lastSync ?? 0));
  const status = syncingNow || checking
    ? 'Checking for mail…'
    : errored
      ? `Couldn’t check ${errored.email}: ${errored.error ?? 'unknown error'}`
      : lastSync
        ? `Updated ${ago(lastSync, now)}`
        : '';

  const filterAccount = activeFilter !== 'all' ? byId.get(activeFilter) : undefined;
  const nameOf = (a: Account) => (settings.fullAddresses ? a.email : a.email.split('@')[0]);
  const title = results ? 'Search' : filterAccount ? nameOf(filterAccount) : 'Inbox';
  const count = results ? results.length : filterAccount ? unreadIn(filterAccount.id) : totalUnread;
  /** In the popup the list stays mounted under the reader, so its scroll position survives. */
  const listHidden = !split && !!open;
  const grouped = activeFilter === 'all' && accounts.length > 1;
  // Unfiltered All view: every inbox shows, with or without mail. (Search results only show inboxes that matched.)
  const everyInbox = grouped && !results && !query.trim();

  const openInbox = (a: Account) => {
    if (a.demo) return void push({ text: 'Sample mail has no Gmail inbox to open.' });
    chrome.tabs.create({ url: gmailThreadUrl(a.email) });
  };

  /** Whether an account's own Primary-only choice is doing anything (it isn't when every inbox is Primary). */
  const ownPrimary = (a: Account) => !!a.primaryOnly && settings.view !== 'unread-primary';

  const groupHead = (a: Account, count: number, leaving: boolean, entering: boolean, empty = false) => (
    <GroupHead
      key={`head-${a.id}`}
      account={a}
      email={a.email}
      count={count}
      empty={empty}
      primary={ownPrimary(a)}
      signedOut={a.status === 'needs-auth'}
      onSignIn={() => reconnect(a)}
      leaving={leaving}
      entering={entering}
      onOpen={() => openInbox(a)}
      onMarkAllRead={() => markAllRead(a)}
      onMenu={(anchor) => setInboxMenu(a, anchor)}
      menuOpen={inboxMenu?.id === a.id && !!menu?.anchor}
    />
  );

  const rowFor = ({ t, leaving, entering }: Item) => {
    const k = keyOf(t);
    return (
      <ThreadRow
        key={k}
        thread={t}
        cursor={!leaving && !!cursor && keyOf(cursor) === k}
        selected={selected.has(k)}
        open={!!open && split && keyOf(open) === k}
        morph={!split && !open && morphOn && morphKey === k && !leaving}
        leaving={leaving}
        entering={entering}
        fullPreview={settings.fullPreviews}
        onOpen={() => openThread(t)}
        onAct={(action) => act(action, [refOf(t)])}
        onSnooze={() => setSnoozing([refOf(t)])}
        onToggleSelect={() => toggleSelect(t)}
        onPoint={() => setCursorKey(k)}
      />
    );
  };

  const composeSheet = composer && !composer.threadId && (
    <Composer
      key={`new-${composer.accountId}`}
      initial={composer}
      accounts={accounts.filter((a) => a.status !== 'needs-auth')}
      sheet
      onSend={send}
      onClose={() => setComposer(null)}
      onDiscard={discard}
    />
  );

  return (
    <LinkContext.Provider value={links}>
    <div className="app">
      <div className={`split ${split && open ? 'has-reader' : ''}`}>
        <section
          className="pane-list"
          aria-label="Conversations"
          aria-hidden={listHidden || undefined}
          inert={listHidden || undefined}
          style={listHidden ? { position: 'absolute', inset: 0, visibility: 'hidden' } : undefined}
        >
          <div className="toolbar">
            {searchOpen ? (
              <label className="searchbar">
                <Search />
                <input
                  ref={searchInput}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Filter, or ↵ to search Gmail"
                  aria-label="Search mail"
                />
                <button
                  className="icon-btn"
                  style={{ width: 22, height: 22 }}
                  title="Close search (Esc)"
                  onClick={() => {
                    setSearchOpen(false);
                    setQuery('');
                  }}
                >
                  <X />
                </button>
              </label>
            ) : (
              <>
                <div className="title">
                  <span className="name" title={title}>
                    {title}
                  </span>
                  {count > 0 && <span className="count">{results ? `${count} found` : count}</span>}
                </div>
                <button className="icon-btn" title="Search (/)" onClick={() => setSearchOpen(true)}>
                  <Search />
                </button>
              </>
            )}
            <button className="icon-btn" title={checking ? 'Checking for mail…' : 'Check for new mail (⇧R)'} aria-busy={checking || undefined} onClick={refresh}>
              <RefreshCw className={searching ? 'spin' : spin.className} onAnimationIteration={spin.onAnimationIteration} />
            </button>
            <button className="icon-btn" title="New message (c)" onClick={compose}>
              <SquarePen />
            </button>
            {layout === 'popup' && (
              <button className="icon-btn" title="Open in side panel" onClick={openPanel}>
                <PanelRight />
              </button>
            )}
            <button className="icon-btn" title={`Settings (${MOD},)`} onClick={openSettings}>
              <SettingsIcon />
            </button>
          </div>

          {accounts.length > 1 && settings.inboxTabs ? (
            <nav className="tabs" aria-label="Inboxes" ref={tabsRef}>
              <button className="tab" aria-pressed={activeFilter === 'all'} onClick={() => setFilter('all')}>
                All <span className="n">{totalUnread || ''}</span>
              </button>
              {accounts.map((a) => (
                <button
                  key={a.id}
                  className="tab"
                  aria-pressed={activeFilter === a.id}
                  onClick={() => setFilter(a.id)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setInboxMenu(a, { x: e.clientX, y: e.clientY, align: 'start' });
                  }}
                  aria-label={`${a.email}${a.status === 'needs-auth' ? ', needs signing in' : ''}`}
                >
                  <span className="monogram">{monograms.get(a.id)}</span>
                  {nameOf(a)}
                  {a.status === 'needs-auth' ? (
                    <span className="warn">
                      <CircleAlert size={12} />
                    </span>
                  ) : (
                    <span className="n">{unreadIn(a.id) || ''}</span>
                  )}
                </button>
              ))}
            </nav>
          ) : (
            <div style={{ borderBottom: '1px solid var(--separator)' }} />
          )}

          {troubled.map((a) => (
            <div className="banner" key={a.id} role="alert">
              <CircleAlert />
              <span>
                <b>{a.email}</b> needs you to sign in again. Its mail won’t update until you do.
              </span>
              <button className="btn" onClick={() => reconnect(a)}>
                Sign in
              </button>
            </div>
          ))}

          {results && (
            <div className="section-label">
              <span style={{ flex: 1 }}>Results for “{resultsFor}”</span>
              <button className="btn quiet" style={{ height: 22, padding: '0 8px', fontSize: 11 }} onClick={clearResults}>
                Back to inbox <kbd>esc</kbd>
              </button>
            </div>
          )}

          {drawn.length === 0 ? (
            <EmptyList searching={!!results || !!query} filtered={!!filterAccount} view={settings.view} />
          ) : (
            <div
              className={`list ${grouped ? 'grouped' : ''}`}
              data-selecting={selected.size > 0 || undefined}
              role="listbox"
              aria-label="Conversations"
              aria-multiselectable
            >
              {everyInbox
                ? // All inboxes: every inbox keeps its heading, in tab order, even with nothing in it.
                  accounts.flatMap((a) => {
                    const items = drawn.filter((d) => d.t.accountId === a.id);
                    // An empty inbox is just its heading; it settles once its last row has folded away.
                    const empty = items.every((d) => d.leaving);
                    return [groupHead(a, unreadIn(a.id), false, false, empty), ...items.map(rowFor)];
                  })
                : drawn.flatMap((item, i) => {
                    const { t } = item;
                    const account = byId.get(t.accountId);
                    const head = grouped && account && (i === 0 || drawn[i - 1].t.accountId !== t.accountId);
                    if (!head) return [rowFor(item)];
                    const n = results ? visible.filter((x) => x.accountId === account.id).length : unreadIn(account.id);
                    // Search results: a heading only where an inbox has results. It leaves with the last of them.
                    const group: Item[] = [];
                    for (let j = i; j < drawn.length && drawn[j].t.accountId === t.accountId; j++) group.push(drawn[j]);
                    return [
                      groupHead(account, n, group.every((g) => g.leaving), group.every((g) => g.entering)),
                      rowFor(item),
                    ];
                  })}
            </div>
          )}

          <footer className="statusbar">
            {keyboard ? (
              <span className="grow" title={status}>
                {selected.size ? `${selected.size} selected · E archive · # delete · H snooze` : status}
              </span>
            ) : (
              <span className="grow nokeys">Click in Glance to use shortcuts</span>
            )}
            <button onClick={() => setPalette(true)} title="Command palette">
              <CommandIcon size={11} /> Commands <kbd>.</kbd> <kbd>{MOD}K</kbd>
            </button>
          </footer>
        </section>

        {open && (
          <section className="pane-reader" aria-label="Conversation">
            <Reader
              key={split ? keyOf(open) : 'reader'}
              account={openAccount}
              subject={open.subject}
              morph={!split && morphOn}
              detail={detail}
              error={detailError}
              settings={settings}
              showBack={!split}
              composing={!!composer && !!composer.threadId}
              composer={
                composer?.threadId ? (
                  <Composer
                    key={`reply-${composer.threadId}`}
                    initial={composer}
                    accounts={accounts}
                    sheet={false}
                    onSend={send}
                    onClose={() => setComposer(null)}
                    onDiscard={discard}
                  />
                ) : undefined
              }
              onBack={() => closeReader()}
              onAct={(action) => act(action, [refOf(open)])}
              onSnooze={() => setSnoozing([refOf(open)])}
              onReply={startReply}
              onOpenInGmail={() => openInGmail(open)}
            />
          </section>
        )}

        {split && !open && visible.length > 0 && (
          <section className="pane-reader">
            <div className="empty">
              <div className="mark">
                <Mail />
              </div>
              <p>
                Select a conversation, or press <kbd>↵</kbd>
              </p>
            </div>
          </section>
        )}
      </div>

      {composeSheet}
      {palette && <Palette commands={commands} onSearch={runSearch} onClose={() => setPalette(false)} />}
      {snoozing && <SnoozeMenu onPick={(at) => snooze(snoozing, at)} onClose={() => setSnoozing(null)} />}
      {inboxMenu && (
        <ActionMenu
          title={inboxMenu.email}
          anchor={menu?.anchor}
          onClose={() => setInboxMenu(null)}
          items={[
            { label: 'Open in Gmail', icon: ExternalLink, run: () => openInbox(inboxMenu) },
            {
              label: 'Mark all read',
              icon: CheckCheck,
              hint: unreadIn(inboxMenu.id) ? String(unreadIn(inboxMenu.id)) : undefined,
              run: () => markAllRead(inboxMenu),
            },
            ...(settings.view !== 'unread-primary'
              ? [{ label: 'Primary only', icon: Inbox, checked: !!inboxMenu.primaryOnly, run: () => togglePrimary(inboxMenu) }]
              : []),
          ]}
        />
      )}
    </div>
    </LinkContext.Provider>
  );
}

function EmptyList({ searching, filtered, view }: { searching: boolean; filtered: boolean; view: string }) {
  if (searching) {
    return (
      <div className="empty">
        <div className="mark">
          <Search />
        </div>
        <h2>Nothing found</h2>
        <p>Try other words, or Gmail operators like from: or has:attachment.</p>
      </div>
    );
  }
  return (
    <div className="empty">
      <div className="mark">
        <Inbox />
      </div>
      <h2>{view === 'inbox' ? 'Inbox empty' : 'All clear'}</h2>
      <p>
        {view === 'inbox'
          ? filtered
            ? 'Nothing in this inbox.'
            : 'Nothing in any of your inboxes.'
          : filtered
            ? 'Nothing unread in this inbox.'
            : 'Nothing unread in any of your inboxes.'}
      </p>
    </div>
  );
}

function Welcome({ onAdd, onDemo, onSettings }: { onAdd: () => void; onDemo: () => void; onSettings: () => void }) {
  return (
    <div className="app">
      <div className="empty">
        <img src="/icon/128.png" alt="" width={56} height={56} style={{ marginBottom: 14, borderRadius: 12 }} />
        <h2>Welcome to Glance</h2>
        <p>Every Gmail inbox you use, in one list. Read, reply and clear mail without opening a tab.</p>
        <div className="actions">
          <button className="btn primary lg" onClick={onAdd}>
            <Plus /> Connect a Gmail account
          </button>
          <button className="btn lg" onClick={onDemo}>
            Try it with sample mail
          </button>
          <button className="btn quiet" onClick={onSettings}>
            Settings
          </button>
        </div>
      </div>
    </div>
  );
}
