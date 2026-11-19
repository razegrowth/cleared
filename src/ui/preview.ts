import { request } from '../shared/store';
import type { MessageDetail, ThreadDetail, ThreadSummary } from '../shared/types';

/**
 * The whole latest message of a thread as readable text, for the list's
 * full-email mode. Fetched only for rows near the screen, three at a time,
 * and kept per thread version so a re-render never fetches twice.
 */

const MAX = 6000;
const cache = new Map<string, string>();
const pending = new Map<string, Promise<string>>();
const waiting: (() => void)[] = [];
let running = 0;

const keyOf = (t: ThreadSummary) => `${t.accountId}|${t.id}|${t.historyId}`;

export function cachedPreview(t: ThreadSummary): string | undefined {
  return cache.get(keyOf(t));
}

async function slot<T>(fn: () => Promise<T>): Promise<T> {
  if (running >= 3) await new Promise<void>((r) => waiting.push(r));
  running++;
  try {
    return await fn();
  } finally {
    running--;
    waiting.shift()?.();
  }
}

export function loadPreview(t: ThreadSummary): Promise<string> {
  const k = keyOf(t);
  const hit = cache.get(k);
  if (hit !== undefined) return Promise.resolve(hit);
  let p = pending.get(k);
  if (!p) {
    p = slot(() => request<ThreadDetail>({ type: 'getThread', accountId: t.accountId, threadId: t.id }))
      .then((d) => {
        const last = d.messages[d.messages.length - 1];
        const text = last ? messageText(last) : t.snippet;
        cache.set(k, text);
        return text;
      })
      .finally(() => pending.delete(k));
    pending.set(k, p);
  }
  return p;
}

export function messageText(m: MessageDetail): string {
  const raw = m.text?.trim() ? stripQuotedText(m.text) : m.html ? htmlToText(m.html) : m.snippet;
  const tidy = raw
    .replace(/\r\n/g, '\n')
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return tidy.length > MAX ? tidy.slice(0, MAX).trimEnd() + '…' : tidy;
}

/** Drops the quoted reply chain that plain-text mail carries below the new part. */
export function stripQuotedText(text: string): string {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const next = lines[i + 1] ?? '';
    // "On Tue, Nov 18, 2026 at 9:41 AM Priya <priya@…> wrote:" (often wrapped onto two lines)
    if (/^On .{4,240}wrote:\s*$/.test(line) || (/^On .{4,240}$/.test(line) && /wrote:\s*$/.test(next))) break;
    if (/^-{2,}\s*(Original|Forwarded) Message/i.test(line)) break;
    if (/^_{8,}$/.test(line.trim())) break;
    if (line.startsWith('>')) continue;
    out.push(line);
  }
  return out.join('\n');
}

export function htmlToText(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc
    .querySelectorAll(
      'style, script, head, title, .gmail_quote, .gmail_extra, blockquote, [id^="divRplyFwdMsg"], #appendonsend',
    )
    .forEach((n) => n.remove());
  // The source's own line breaks mean nothing in HTML; only the markup's do.
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!n.parentElement?.closest('pre')) n.nodeValue = (n.nodeValue ?? '').replace(/\s+/g, ' ');
  }
  doc.querySelectorAll('br').forEach((b) => b.replaceWith('\n'));
  // Paragraphs and headings get a blank line after them; other blocks a line break.
  doc.querySelectorAll('p, h1, h2, h3, h4, h5, h6, ul, ol, table, blockquote').forEach((el) => el.append('\n\n'));
  doc.querySelectorAll('div, tr, li, section, article').forEach((el) => el.append('\n'));
  doc.querySelectorAll('td, th').forEach((el) => el.append(' '));
  doc.querySelectorAll('li').forEach((el) => el.prepend('• '));
  return doc.body?.textContent ?? '';
}
