import type { Person, Settings } from './types';

export function gmailThreadUrl(email: string, threadId?: string): string {
  const base = `https://mail.google.com/mail/u/?authuser=${encodeURIComponent(email)}`;
  return threadId ? `${base}#all/${threadId}` : `${base}#inbox`;
}

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** "9:41", "Yesterday", "Tue", "Mar 4", "3/4/24", the way Mail shows dates. */
export function shortDate(ms: number, now = new Date()): string {
  const d = new Date(ms);
  if (sameDay(d, now)) return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(d, yesterday)) return 'Yesterday';
  const days = (now.getTime() - ms) / 86_400_000;
  if (days < 6) return d.toLocaleDateString(undefined, { weekday: 'short' });
  if (d.getFullYear() === now.getFullYear()) return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return d.toLocaleDateString(undefined, { year: '2-digit', month: 'numeric', day: 'numeric' });
}

/** "11:38 PM" today, "Nov 18, 11:38 PM" otherwise. */
export function mediumDate(ms: number, now = new Date()): string {
  const d = new Date(ms);
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (sameDay(d, now)) return time;
  const day = d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(d.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  });
  return `${day}, ${time}`;
}

export function longDate(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function initials(p: Pick<Person, 'name' | 'email'>): string {
  const n = (p.name || p.email).replace(/[^\p{L}\p{N}\s]/gu, '').trim();
  const parts = n.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return (parts[0]?.slice(0, 2) ?? '?').toUpperCase();
}

/** Stable pastel-ish hue per sender, for avatars without pictures. */
export function hueFor(s: string): number {
  let h = 0;
  for (const ch of s.toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

export function inQuietHours(settings: Settings, now = new Date()): boolean {
  const q = settings.quietHours;
  if (!q.enabled) return false;
  const t = now.getHours() * 60 + now.getMinutes();
  const start = minutesOf(q.start);
  const end = minutesOf(q.end);
  return start <= end ? t >= start && t < end : t >= start || t < end;
}

/** VIP entries are full addresses or bare domains ("@client.com" or "client.com"). */
export function isVip(settings: Settings, email: string): boolean {
  const e = email.toLowerCase();
  return settings.vips.some((v) => {
    const x = v.trim().toLowerCase();
    if (!x) return false;
    if (x.includes('@') && !x.startsWith('@')) return x === e;
    return e.endsWith('@' + x.replace(/^@/, '')) || e.endsWith('.' + x.replace(/^@/, ''));
  });
}

/**
 * Characters senders pad preview text with so Gmail shows only their chosen
 * line: zero-width spaces and joiners, soft hyphens, the combining grapheme
 * joiner, bidi controls. They render as nothing, or as text pushed to the
 * wrong side of the line.
 */
const INVISIBLE = /[­͏؜ᅟᅠ឴឵᠎​-‏‪-‮⁠-⁯ㅤ﻿ﾠ]/g;

/** A preview line as plain text: no invisible padding, runs of space as one. */
export function tidySnippet(s: string): string {
  return s.replace(INVISIBLE, '').replace(/\s+/g, ' ').trim();
}

/** Longer text with its line breaks kept, minus the invisible padding. */
export function tidyText(s: string): string {
  return s.replace(INVISIBLE, '').replace(/[ \t ]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}
