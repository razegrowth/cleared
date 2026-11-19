import { Send, Trash2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { MOD } from './hooks';
import { getKey } from '../shared/store';
import type { Account, Draft } from '../shared/types';

export const draftKey = (d: Pick<Draft, 'accountId' | 'threadId'>) => `draft:${d.accountId}:${d.threadId ?? 'new'}`;

export async function loadDraft(d: Pick<Draft, 'accountId' | 'threadId'>): Promise<(Draft & { failed?: string }) | undefined> {
  return getKey<Draft & { failed?: string }>(draftKey(d));
}

export function clearDraft(d: Pick<Draft, 'accountId' | 'threadId'>) {
  return chrome.storage.local.remove(draftKey(d));
}

interface Props {
  initial: Draft & { failed?: string };
  accounts: Account[];
  sheet: boolean;
  onSend: (d: Draft) => Promise<void>;
  onClose: () => void;
  onDiscard: () => void;
}

/**
 * Plain, quick writing. The draft saves itself as you type, so closing the
 * popup mid-sentence loses nothing; reopen the reply and it's there.
 */
export function Composer({ initial, accounts, sheet, onSend, onClose, onDiscard }: Props) {
  const [d, setD] = useState<Draft>(initial);
  const [showCc, setShowCc] = useState(!!initial.cc || !!initial.bcc);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | undefined>(initial.failed);
  const body = useRef<HTMLTextAreaElement>(null);
  const to = useRef<HTMLInputElement>(null);
  const isNew = !initial.threadId;

  useEffect(() => {
    (isNew && !d.to ? to.current : body.current)?.focus();
    const el = body.current;
    if (el && !isNew) el.setSelectionRange(0, 0);
  }, []);

  // Save as they type; the key moves if the "from" account changes.
  useEffect(() => {
    const t = setTimeout(() => {
      const empty = !d.body.trim() && (!isNew || (!d.to.trim() && !d.subject.trim()));
      if (empty) clearDraft(d);
      else chrome.storage.local.set({ [draftKey(d)]: d });
    }, 300);
    return () => clearTimeout(t);
  }, [d]);

  const set = (patch: Partial<Draft>) => setD((x) => ({ ...x, ...patch }));

  const send = async () => {
    if (!d.to.trim() && !d.cc.trim() && !d.bcc.trim()) {
      setError('Add at least one recipient.');
      to.current?.focus();
      return;
    }
    setSending(true);
    setError(undefined);
    try {
      await onSend(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSending(false);
    }
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      send();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    }
  };

  const changeFrom = (accountId: string) => {
    clearDraft(d);
    set({ accountId });
  };

  return (
    <div className={`composer ${sheet ? 'sheet' : ''}`} onKeyDown={onKey}>
      <div className="head">
        <span className="grow">{isNew ? 'New message' : d.subject}</span>
        <button className="icon-btn" title="Close and keep draft (Esc)" onClick={onClose}>
          <X />
        </button>
      </div>
      {isNew && accounts.length > 1 && (
        <div className="field">
          <label htmlFor="from">From</label>
          <select id="from" value={d.accountId} onChange={(e) => changeFrom(e.target.value)}>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} &lt;{a.email}&gt;
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="field">
        <label htmlFor="to">To</label>
        <input id="to" ref={to} value={d.to} onChange={(e) => set({ to: e.target.value })} autoComplete="off" spellCheck={false} />
        {!showCc && (
          <button className="toggle" onClick={() => setShowCc(true)}>
            Cc/Bcc
          </button>
        )}
      </div>
      {showCc && (
        <>
          <div className="field">
            <label htmlFor="cc">Cc</label>
            <input id="cc" value={d.cc} onChange={(e) => set({ cc: e.target.value })} autoComplete="off" spellCheck={false} />
          </div>
          <div className="field">
            <label htmlFor="bcc">Bcc</label>
            <input id="bcc" value={d.bcc} onChange={(e) => set({ bcc: e.target.value })} autoComplete="off" spellCheck={false} />
          </div>
        </>
      )}
      {isNew && (
        <div className="field">
          <label htmlFor="subject">Subject</label>
          <input id="subject" value={d.subject} onChange={(e) => set({ subject: e.target.value })} />
        </div>
      )}
      {error && <div className="error">{error}</div>}
      <textarea
        ref={body}
        value={d.body}
        onChange={(e) => set({ body: e.target.value })}
        placeholder={isNew ? '' : 'Write your reply…'}
      />
      <div className="foot">
        <span className="hint">{d.quote ? 'Quoted text is included below your reply.' : ''}</span>
        <button className="icon-btn" title="Discard draft" onClick={onDiscard}>
          <Trash2 />
        </button>
        <button className="btn primary" onClick={send} disabled={sending}>
          <Send /> Send <kbd>{MOD}↵</kbd>
        </button>
      </div>
    </div>
  );
}
