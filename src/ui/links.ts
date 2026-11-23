import { createContext, useContext, useRef } from 'react';

/**
 * Links in mail. Cleared opens them itself rather than trusting the browser to
 * follow a link out of a sandboxed frame inside an extension popup: Quo, for
 * one, never does. Only web and mailto links go anywhere; javascript:, file:,
 * data: and the rest do nothing.
 */

export interface Mailto {
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  body: string;
}

export function parseMailto(href: string): Mailto | null {
  if (!/^mailto:/i.test(href)) return null;
  const [addr, query = ''] = href.slice(7).split('?');
  const q = new URLSearchParams(query);
  const decode = (s: string) => {
    try {
      return decodeURIComponent(s);
    } catch {
      return s;
    }
  };
  const join = (...parts: (string | null)[]) =>
    parts
      .filter(Boolean)
      .flatMap((p) => decode(p!).split(','))
      .map((s) => s.trim())
      .filter(Boolean)
      .join(', ');
  return {
    to: join(addr, q.get('to')),
    cc: q.get('cc') ?? '',
    bcc: q.get('bcc') ?? '',
    subject: q.get('subject') ?? '',
    body: q.get('body') ?? '',
  };
}

/** A link worth following: an absolute http(s) URL, or null. */
export function webUrl(href: string): string | null {
  try {
    const u = new URL(href);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
  } catch {
    return null;
  }
}

export const LinkContext = createContext<{ onMailto?: (m: Mailto) => void }>({});

/** Opens a link from an email: web links in a tab (a background one with ⌘ or a middle click), mailto in the composer. */
export function useOpenLink() {
  const { onMailto } = useContext(LinkContext);
  const latest = useRef(onMailto);
  latest.current = onMailto;
  return useRef((href: string | null, background: boolean) => {
    if (!href) return;
    const mail = parseMailto(href.trim());
    if (mail) return void latest.current?.(mail);
    const url = webUrl(href.trim());
    if (!url) return;
    const fallback = () => window.open(url, '_blank', 'noopener');
    try {
      Promise.resolve(chrome.tabs.create({ url, active: !background })).catch(fallback);
    } catch {
      fallback();
    }
  }).current;
}
