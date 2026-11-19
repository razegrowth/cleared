import { useEffect, useRef, useState } from 'react';
import { loadState, onStateChange } from '../shared/store';
import type { MailState, Settings } from '../shared/types';

/** The whole mail state, kept live from storage. */
export function useMail(): MailState | null {
  const [state, setState] = useState<MailState | null>(null);
  useEffect(() => {
    let alive = true;
    loadState().then((s) => alive && setState(s));
    const off = onStateChange((patch) => setState((s) => (s ? { ...s, ...patch } : s)));
    return () => {
      alive = false;
      off();
    };
  }, []);
  return state;
}

export function useTheme(settings: Settings | undefined) {
  useEffect(() => {
    const root = document.documentElement;
    if (!settings || settings.theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', settings.theme);
  }, [settings?.theme]);
}

export function useWidth(): number {
  const [w, setW] = useState(() => window.innerWidth);
  useEffect(() => {
    const on = () => setW(window.innerWidth);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return w;
}

/** Re-renders every `ms`, for "updated 2 min ago" labels. */
export function useNow(ms = 30_000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

export function useLatest<T>(value: T) {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}

/** True when keystrokes belong to a text field, not to Glance's shortcuts. */
export function typingIn(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
}

export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
export const MOD = isMac ? '⌘' : 'Ctrl';
