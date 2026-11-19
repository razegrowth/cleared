import { Archive, ArrowUpRight, Check, CheckCheck, Clock, Ellipsis, Mail, MailOpen, Paperclip, Star, Trash2 } from 'lucide-react';
import { memo, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { under, type MenuAnchor } from './Palette';
import { cachedPreview, loadPreview } from './preview';
import { shortDate, tidySnippet, tidyText } from '../shared/format';
import type { Account, ThreadAction, ThreadSummary } from '../shared/types';
import { Avatar } from './Avatar';

interface Props {
  thread: ThreadSummary;
  /** The account's monogram, shown when several inboxes share the list. */
  monogram?: { label: string; title: string };
  cursor: boolean;
  selected: boolean;
  open: boolean;
  /** Carries the subject into the reader's title during the open transition. */
  morph: boolean;
  /** Folding away after an archive, delete or read. */
  leaving: boolean;
  /** Arrived since the list was first drawn. */
  entering: boolean;
  fullPreview: boolean;
  onOpen: () => void;
  onAct: (action: ThreadAction) => void;
  onSnooze: () => void;
  onToggleSelect: () => void;
  onPoint: () => void;
}

const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';
const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/**
 * How a line of the list comes and goes. Leaving, it holds its height while
 * it fades and slides aside, then closes to nothing. Arriving (only when it
 * mounts), it opens up first and then fades in.
 */
function useFold(ref: RefObject<HTMLElement | null>, leaving: boolean, entering: boolean) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!leaving || !el || reduced()) return;
    const h = el.offsetHeight;
    const fold = el.animate(
      [
        { height: `${h}px`, opacity: 1, transform: 'translateX(0)' },
        { height: `${h}px`, opacity: 0, transform: 'translateX(-14px)', offset: 0.45 },
        {
          height: '0px',
          opacity: 0,
          paddingTop: '0px',
          paddingBottom: '0px',
          borderBottomWidth: '0px',
          transform: 'translateX(-14px)',
        },
      ],
      { duration: 300, easing: EASE, fill: 'forwards' },
    );
    // Back after all (an undo, or new mail in the same inbox): open up again.
    return () => fold.cancel();
  }, [leaving]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!entering || !el || reduced()) return;
    const h = el.offsetHeight;
    el.animate(
      [
        { height: '0px', opacity: 0, paddingTop: '0px', paddingBottom: '0px', borderBottomWidth: '0px' },
        { height: `${h}px`, opacity: 0, offset: 0.5 },
        { height: `${h}px`, opacity: 1 },
      ],
      { duration: 360, easing: EASE },
    );
  }, []);
}

/** An inbox's heading in the All view. Clicking it opens that inbox in Gmail. */
export function GroupHead({
  account,
  email,
  count,
  empty,
  primary,
  signedOut,
  onSignIn,
  leaving,
  entering,
  onOpen,
  onMarkAllRead,
  onMenu,
  menuOpen,
}: {
  account: Account;
  email: string;
  count: number;
  /** Nothing to show under it: the heading stands alone, quieter. */
  empty?: boolean;
  /** This account lists only its Primary tab. */
  primary?: boolean;
  /** Google signed it out: its mail is stale until someone signs in again. */
  signedOut?: boolean;
  onSignIn?: () => void;
  leaving: boolean;
  entering: boolean;
  onOpen: () => void;
  onMarkAllRead: () => void;
  /** Opens the inbox's menu at the button, or at the pointer for a right-click. */
  onMenu: (anchor: MenuAnchor) => void;
  menuOpen?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useFold(ref, leaving, entering);
  const off = leaving ? -1 : undefined;
  return (
    <div
      ref={ref}
      className="group-head"
      data-empty={empty || undefined}
      data-menu={menuOpen || undefined}
      aria-hidden={leaving || undefined}
      style={leaving ? { pointerEvents: 'none' } : undefined}
      onContextMenu={(e) => {
        e.preventDefault();
        onMenu({ x: e.clientX, y: e.clientY, align: 'start' });
      }}
    >
      <button className="gh-main" title={`Open ${email} in Gmail`} tabIndex={off} onClick={onOpen}>
        <Avatar person={account} picture={account.picture} tint={account.color} size="xs" />
        <span className="addr">{email}</span>
        {primary && <span className="gh-tag">Primary</span>}
        <ArrowUpRight className="out" aria-hidden />
        {count > 0 && !signedOut && <span className="n">{count}</span>}
      </button>
      {signedOut && (
        <button className="gh-signin" title={`Sign in to ${email} again`} tabIndex={off} onClick={onSignIn}>
          Sign in again
        </button>
      )}
      {count > 0 && (
        <button className="gh-act" title={`Mark all read in ${email}`} aria-label={`Mark all read in ${email}`} tabIndex={off} onClick={onMarkAllRead}>
          <CheckCheck />
        </button>
      )}
      <button
        className="gh-act"
        title="More"
        aria-label={`More for ${email}`}
        aria-haspopup="menu"
        aria-expanded={menuOpen || false}
        tabIndex={off}
        onClick={(e) => onMenu(under(e.currentTarget))}
      >
        <Ellipsis />
      </button>
    </div>
  );
}

function sender(t: ThreadSummary): string {
  if (t.participants.length > 1) {
    const shown = t.participants.slice(-3);
    return (t.participants.length > 3 ? '… ' : '') + shown.join(', ');
  }
  return t.from.name || t.from.email;
}

/** The thread's whole latest message, fetched once the row comes near the screen. */
function useFullText(t: ThreadSummary, enabled: boolean, el: React.RefObject<HTMLDivElement | null>) {
  const [text, setText] = useState<string | undefined>(() => (enabled ? cachedPreview(t) : undefined));
  useEffect(() => {
    if (!enabled) return;
    const hit = cachedPreview(t);
    if (hit !== undefined) return void setText(hit);
    setText(undefined);
    const node = el.current;
    if (!node) return;
    let alive = true;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io.disconnect();
        loadPreview(t)
          .then((s) => alive && setText(s))
          .catch(() => alive && setText(t.snippet));
      },
      { rootMargin: '400px 0px' },
    );
    io.observe(node);
    return () => {
      alive = false;
      io.disconnect();
    };
  }, [enabled, t.accountId, t.id, t.historyId]);
  return text;
}

export const ThreadRow = memo(function ThreadRow({
  thread: t,
  monogram,
  cursor,
  selected,
  open,
  morph,
  leaving,
  entering,
  fullPreview,
  onOpen,
  onAct,
  onSnooze,
  onToggleSelect,
  onPoint,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const full = useFullText(t, fullPreview, ref);

  useEffect(() => {
    if (cursor && !leaving) ref.current?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  useFold(ref, leaving, entering);
  const snippet = tidySnippet(t.snippet);

  return (
    <div
      ref={ref}
      className="row"
      role="option"
      aria-selected={cursor}
      data-cursor={cursor && !open}
      data-selected={selected}
      data-open={open}
      data-unread={t.unread}
      aria-hidden={leaving || undefined}
      style={leaving ? { pointerEvents: 'none' } : undefined}
      onClick={(e) => (e.metaKey || e.shiftKey ? onToggleSelect() : onOpen())}
      onMouseMove={cursor || leaving ? undefined : onPoint}
    >
      <div className="gutter">
        {t.unread && <span className="unread-mark" aria-label="Unread" />}
        <button
          className="check"
          title="Select (x)"
          aria-label={selected ? 'Deselect' : 'Select'}
          onClick={(e) => {
            e.stopPropagation();
            onToggleSelect();
          }}
        >
          {selected && <Check />}
        </button>
      </div>
      <div className="body">
        <div className="line1">
          <span className="from">
            {sender(t)}
            {t.messageCount > 1 && <span className="n">{t.messageCount}</span>}
          </span>
          <span className="meta">
            {t.hasAttachment && <Paperclip aria-label="Has attachment" />}
            {t.starred && <Star className="star" aria-label="Starred" />}
            {monogram && (
              <span className="monogram" title={monogram.title}>
                {monogram.label}
              </span>
            )}
          </span>
          <span className="time">{shortDate(t.date)}</span>
        </div>
        <div className="subject" style={morph ? { viewTransitionName: 'glance-subject' } : undefined}>
          {t.subject}
        </div>
        {fullPreview ? (
          <div className={`snippet full ${full === undefined ? 'loading' : ''}`}>{tidyText(full ?? t.snippet)}</div>
        ) : (
          snippet && <div className="snippet">{snippet}</div>
        )}
      </div>

      <div className="row-actions" onClick={(e) => e.stopPropagation()}>
        <button className="icon-btn" title="Archive (e)" onClick={() => onAct('archive')}>
          <Archive />
        </button>
        <button
          className="icon-btn"
          title={t.unread ? 'Mark as read (⇧I)' : 'Mark as unread (⇧U)'}
          onClick={() => onAct(t.unread ? 'read' : 'unread')}
        >
          {t.unread ? <MailOpen /> : <Mail />}
        </button>
        <button className="icon-btn" title="Snooze (h)" onClick={onSnooze}>
          <Clock />
        </button>
        <button className="icon-btn" title="Delete (#)" onClick={() => onAct('trash')}>
          <Trash2 />
        </button>
      </div>
    </div>
  );
});
