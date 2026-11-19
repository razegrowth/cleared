import { Archive, ArrowLeft, Clock, ExternalLink, FileText, Image as ImageIcon, Mail, Reply, ReplyAll, Star, Trash2 } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Avatar } from './Avatar';
import { EmailBody } from './EmailBody';
import { fileSize, longDate, mediumDate, shortDate } from '../shared/format';
import { request } from '../shared/store';
import type { Account, Attachment, MessageDetail, Settings, ThreadAction, ThreadDetail } from '../shared/types';
import { useToasts } from './Toasts';

interface Props {
  account?: Account;
  /** Known from the list before the conversation loads, so the title is there at once. */
  subject: string;
  /** Takes part in the list-to-reader transition as the subject line. */
  morph: boolean;
  detail: ThreadDetail | null;
  error?: string;
  settings: Settings;
  showBack: boolean;
  composing: boolean;
  composer?: ReactNode;
  onBack: () => void;
  onAct: (action: ThreadAction) => void;
  onSnooze: () => void;
  onReply: (all: boolean) => void;
  onOpenInGmail: () => void;
}

async function download(accountId: string, a: Attachment) {
  const data = await request<string>({ type: 'getAttachment', accountId, messageId: a.messageId, attachmentId: a.id });
  const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: a.mimeType || 'application/octet-stream' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = a.filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function names(people: { name: string; email: string }[], me?: string) {
  return people.map((p) => (p.email.toLowerCase() === me ? 'me' : p.name || p.email)).join(', ');
}

function Message({
  m,
  account,
  expanded,
  onToggle,
  settings,
}: {
  m: MessageDetail;
  account?: Account;
  expanded: boolean;
  onToggle: () => void;
  settings: Settings;
}) {
  const { push } = useToasts();
  const [images, setImages] = useState(settings.remoteImages === 'always');
  const me = account?.email.toLowerCase();

  if (!expanded) {
    return (
      <div className="msg collapsed" onClick={onToggle}>
        <Avatar person={m.from} />
        <div className="who">
          <b>{m.from.email.toLowerCase() === me ? 'Me' : m.from.name}</b>
          <span>{m.snippet}</span>
        </div>
        <time>{shortDate(m.date)}</time>
      </div>
    );
  }

  const files = m.attachments.filter((a) => !a.inline || !m.html?.includes(`cid:${a.contentId}`));
  return (
    <article className="msg expanded">
      <header className="msg-head" onClick={onToggle}>
        <Avatar person={m.from} size="md" />
        <div className="who">
          <div className="name">
            <b>{m.from.email.toLowerCase() === me ? 'Me' : m.from.name}</b>
            <span>{m.from.email}</span>
          </div>
          <div className="to">
            to {names(m.to, me) || 'undisclosed recipients'}
            {m.cc.length > 0 && `, cc ${names(m.cc, me)}`}
          </div>
        </div>
        <time title={longDate(m.date)}>{mediumDate(m.date)}</time>
      </header>
      {account && (
        <EmailBody
          message={m}
          accountId={account.id}
          imagesAllowed={images}
          onAllowImages={() => setImages(true)}
          onAlwaysAllow={() => {
            setImages(true);
            request({ type: 'updateSettings', patch: { remoteImages: 'always' } });
          }}
        />
      )}
      {files.length > 0 && (
        <div className="attachments">
          {files.map((a) => (
            <button
              key={a.id}
              className="attachment"
              title={`Download ${a.filename}`}
              onClick={() =>
                download(account!.id, a).catch((e) => push({ text: `Couldn’t download: ${e.message}`, error: true }))
              }
            >
              {a.mimeType.startsWith('image/') ? <ImageIcon /> : <FileText />}
              <span className="name">{a.filename}</span>
              <span className="size">{fileSize(a.size)}</span>
            </button>
          ))}
        </div>
      )}
    </article>
  );
}

export function Reader({
  account,
  subject,
  morph,
  detail,
  error,
  settings,
  showBack,
  composing,
  composer,
  onBack,
  onAct,
  onSnooze,
  onReply,
  onOpenInGmail,
}: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!detail) return;
    const msgs = detail.messages;
    // The newest message, plus anything unread, starts open; older ones fold.
    const open = new Set(msgs.filter((m, i) => m.unread || i === msgs.length - 1).map((m) => m.id));
    setExpanded(open);
  }, [detail?.id, detail?.messages.length]);

  const toggle = (id: string) =>
    setExpanded((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  return (
    <div className="reader">
      <div className="toolbar">
        {showBack && (
          <button className="icon-btn" title="Back (Esc)" onClick={onBack}>
            <ArrowLeft />
          </button>
        )}
        <div className="title" />
        <button className="icon-btn" title="Archive (e)" onClick={() => onAct('archive')} disabled={!detail}>
          <Archive />
        </button>
        <button className="icon-btn" title="Delete (#)" onClick={() => onAct('trash')} disabled={!detail}>
          <Trash2 />
        </button>
        <button className="icon-btn" title="Mark as unread (⇧U)" onClick={() => onAct('unread')} disabled={!detail}>
          <Mail />
        </button>
        <button className="icon-btn" title="Snooze (h)" onClick={onSnooze} disabled={!detail}>
          <Clock />
        </button>
        <button
          className="icon-btn"
          title={detail?.starred ? 'Unstar (s)' : 'Star (s)'}
          data-active={detail?.starred}
          onClick={() => onAct(detail?.starred ? 'unstar' : 'star')}
          disabled={!detail}
        >
          <Star fill={detail?.starred ? 'currentColor' : 'none'} />
        </button>
        {!account?.demo && (
          <button className="icon-btn" title="Open in Gmail (g)" onClick={onOpenInGmail} disabled={!detail}>
            <ExternalLink />
          </button>
        )}
      </div>

      <div className="scroll">
        <h1 style={morph ? { viewTransitionName: 'glance-subject' } : undefined}>{detail?.subject ?? subject}</h1>
        <div className="thread-meta">
          <span>{account?.email}</span>
          {detail && detail.messages.length > 1 && <span>· {detail.messages.length} messages</span>}
        </div>
        {error ? (
          <div className="empty">
            <h2>Couldn’t open this conversation</h2>
            <p>{error}</p>
          </div>
        ) : !detail ? (
          <div className="skeleton" aria-label="Loading">
            <div style={{ width: '42%' }} />
            <div style={{ width: '95%', marginTop: 18 }} />
            <div style={{ width: '88%' }} />
            <div style={{ width: '92%' }} />
            <div style={{ width: '60%' }} />
          </div>
        ) : (
          <div className="reveal">
            {detail.messages.map((m) => (
              <Message
                key={m.id}
                m={m}
                account={account}
                expanded={expanded.has(m.id)}
                onToggle={() => toggle(m.id)}
                settings={settings}
              />
            ))}
          </div>
        )}
      </div>

      {composing
        ? composer
        : detail && (
            <div className="reply-bar">
              <button className="btn" onClick={() => onReply(false)}>
                <Reply /> Reply <kbd>R</kbd>
              </button>
              <button className="btn" onClick={() => onReply(true)}>
                <ReplyAll /> Reply all <kbd>A</kbd>
              </button>
            </div>
          )}
    </div>
  );
}
