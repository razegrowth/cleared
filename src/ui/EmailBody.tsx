import { ImageOff } from 'lucide-react';
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useOpenLink } from './links';
import { cleanEmail } from './sanitize';
import { request } from '../shared/store';
import type { MessageDetail } from '../shared/types';

/**
 * The email's own styles live in a shadow root, so they can't reach Glance's
 * UI and Glance's can't reach them. `contain` keeps anything positioned
 * fixed inside the email from escaping its paper.
 */
const SHEET = `
:host { all: initial; display: block; contain: layout paint; }
.glance-body {
  display: block;
  padding: 14px 16px;
  background: #fff;
  color: #1d1d1f;
  font: 14px/1.5 -apple-system, BlinkMacSystemFont, 'Helvetica Neue', Helvetica, Arial, sans-serif;
  overflow-wrap: anywhere;
  word-break: break-word;
  overflow-x: auto;
  -webkit-font-smoothing: antialiased;
}
.glance-body img { max-width: 100%; height: auto; }
.glance-body table { max-width: 100% !important; }
.glance-body pre { white-space: pre-wrap; }
.glance-body a { color: #0a0a0a; text-decoration: underline; text-underline-offset: 2px; cursor: pointer; }
.glance-body blockquote { margin: 0 0 0 .8ex; border-left: 2px solid #d2d2d7; padding-left: 1ex; color: #55555a; }
.hide-quotes .gmail_quote, .hide-quotes .gmail_extra, .hide-quotes blockquote[type="cite"],
.hide-quotes #appendonsend ~ *, .hide-quotes div[id^="divRplyFwdMsg"], .hide-quotes div[id^="divRplyFwdMsg"] ~ * {
  display: none !important;
}
`;

function hasQuote(html: string) {
  return /class="?gmail_quote|type="?cite|id="?(appendonsend|divRplyFwdMsg)/i.test(html);
}

export function EmailBody({
  message,
  accountId,
  imagesAllowed,
  onAllowImages,
  onAlwaysAllow,
}: {
  message: MessageDetail;
  accountId: string;
  imagesAllowed: boolean;
  onAllowImages: () => void;
  onAlwaysAllow: () => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const openLink = useOpenLink();
  const [showQuotes, setShowQuotes] = useState(false);
  const [inline, setInline] = useState<Map<string, string>>(new Map());

  // Inline (cid:) images: fetch their data so they can be shown in place.
  useEffect(() => {
    let alive = true;
    setInline(new Map());
    const html = message.html;
    const wanted = message.attachments.filter((a) => a.contentId && html?.includes(`cid:${a.contentId}`));
    if (!html || !wanted.length) return;
    Promise.all(
      wanted.map(async (a) => {
        const data = await request<string>({ type: 'getAttachment', accountId, messageId: a.messageId, attachmentId: a.id });
        return [a.contentId!, `data:${a.mimeType};base64,${data}`] as const;
      }),
    )
      .then((pairs) => alive && setInline(new Map(pairs)))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [message.id, message.html, accountId]);

  const cleaned = useMemo(
    () => (message.html ? cleanEmail(message.html, { remoteImages: imagesAllowed, inline }) : null),
    [message.html, imagesAllowed, inline],
  );

  useLayoutEffect(() => {
    const el = host.current;
    if (!el || !cleaned) return;
    const root = el.shadowRoot ?? el.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>${SHEET}</style><div class="glance-body ${showQuotes ? '' : 'hide-quotes'}">${cleaned.html}</div>`;
  }, [cleaned, showQuotes]);

  // Clicks inside the shadow root reach the host; the composed path says which link.
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const follow = (e: MouseEvent) => {
      if (e.type === 'auxclick' && e.button !== 1) return;
      const a = e
        .composedPath()
        .find((n): n is HTMLAnchorElement => n instanceof Element && n.tagName === 'A' && n.hasAttribute('href'));
      if (!a) return;
      e.preventDefault();
      openLink(a.getAttribute('href'), e.metaKey || e.ctrlKey || e.button === 1);
    };
    el.addEventListener('click', follow);
    el.addEventListener('auxclick', follow);
    return () => {
      el.removeEventListener('click', follow);
      el.removeEventListener('auxclick', follow);
    };
  }, [openLink]);

  if (!message.html) return <PlainText text={message.text ?? message.snippet} />;

  return (
    <>
      {cleaned?.blockedRemote && (
        <div className="images-banner">
          <ImageOff />
          <span>Remote images are hidden.</span>
          <button className="btn quiet" onClick={onAlwaysAllow}>
            Always load
          </button>
          <button className="btn" onClick={onAllowImages}>
            Load images
          </button>
        </div>
      )}
      <div className="paper">
        <div ref={host} className="email-host" />
      </div>
      {hasQuote(message.html) && (
        <button className="quote-toggle" title={showQuotes ? 'Hide quoted text' : 'Show quoted text'} onClick={() => setShowQuotes((s) => !s)}>
          •••
        </button>
      )}
    </>
  );
}

const URL_RE = /(https?:\/\/[^\s<>"]+[^\s<>".,;:!?)\]'])/g;

function Linkified({ text }: { text: string }) {
  const openLink = useOpenLink();
  const parts = text.split(URL_RE);
  return (
    <>
      {parts.map((p, i) =>
        i % 2 === 1 ? (
          <a
            key={i}
            href={p}
            rel="noreferrer"
            onClick={(e) => {
              e.preventDefault();
              openLink(p, e.metaKey || e.ctrlKey);
            }}
            onAuxClick={(e) => {
              if (e.button !== 1) return;
              e.preventDefault();
              openLink(p, true);
            }}
          >
            {p}
          </a>
        ) : (
          <Fragment key={i}>{p}</Fragment>
        ),
      )}
    </>
  );
}

export function PlainText({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trimEnd().split('\n');
  return (
    <div className="plain">
      {lines.map((line, i) => (
        <Fragment key={i}>
          {line.startsWith('>') ? (
            <span className="quoted">
              <Linkified text={line} />
            </span>
          ) : (
            <Linkified text={line} />
          )}
          {i < lines.length - 1 && '\n'}
        </Fragment>
      ))}
    </div>
  );
}
